// Package consumer contains the worker-side bootstrap boundary.
package consumer

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/SiroBaby/LearningPlatform/worker/internal/processing"
)

// Bootstrap deliberately does not consume durable deliveries. Issue #21 owns
// the PostgreSQL handoff and persistence boundary required by ADR-0023.
type Bootstrap struct {
	started   atomic.Bool
	store     processing.Store
	objects   processing.ObjectReader
	generator processing.Generator
}

func NewBootstrap() *Bootstrap {
	return &Bootstrap{}
}

func New(store processing.Store, objects processing.ObjectReader, generator processing.Generator) *Bootstrap {
	return &Bootstrap{store: store, objects: objects, generator: generator}
}

func (bootstrap *Bootstrap) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	bootstrap.started.Store(true)
	if bootstrap.store == nil {
		return nil
	}
	go bootstrap.loop(ctx)
	return nil
}

func (bootstrap *Bootstrap) Close() {
	bootstrap.started.Store(false)
}

func (bootstrap *Bootstrap) Ready() bool {
	return bootstrap.started.Load()
}

func (bootstrap *Bootstrap) loop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if err := bootstrap.processOne(ctx); err != nil && ctx.Err() == nil {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (bootstrap *Bootstrap) processOne(ctx context.Context) error {
	job, err := bootstrap.store.Claim(ctx)
	if err != nil || job == nil {
		return err
	}
	source, err := bootstrap.store.Source(ctx, *job)
	if err != nil {
		return bootstrap.finish(ctx, *job, err)
	}
	bytes, err := bootstrap.objects.Read(ctx, source.StorageRef, 20*1024*1024)
	if err != nil {
		return bootstrap.finish(ctx, *job, err)
	}
	segments, err := processing.Extract(source, bytes)
	if err != nil {
		return bootstrap.finish(ctx, *job, err)
	}
	chunks, err := processing.ChunkText(job.DocumentID, job.OwnerID, segments)
	if err != nil {
		return bootstrap.finish(ctx, *job, err)
	}
	questions := make([]processing.Question, 0, len(chunks))
	for index, chunk := range chunks {
		question, err := bootstrap.generator.Generate(ctx, chunk.Text)
		if err != nil {
			return bootstrap.finish(ctx, *job, err)
		}
		question.ChunkID = chunk.ID
		question.ChunkIndex = chunk.Index
		question.Ordinal = index
		question.Citation = processing.Citation{ChunkID: chunk.ID, Locator: chunk.Locator, Snippet: chunk.Text}
		questions = append(questions, question)
	}
	_, err = bootstrap.store.PersistAndComplete(ctx, *job, chunks, questions)
	return err
}

func (bootstrap *Bootstrap) finish(ctx context.Context, job processing.Job, err error) error {
	var failure processing.Failure
	if !errors.As(err, &failure) {
		failure = processing.Failure{Code: processing.ProcessingFailed, Technical: true}
	}
	if failure.Technical {
		_, retryErr := bootstrap.store.Retry(ctx, job, failure.Code)
		return retryErr
	}
	_, failErr := bootstrap.store.Fail(ctx, job, failure)
	return failErr
}
