// Package consumer contains the worker-side bootstrap boundary.
package consumer

import (
	"context"
	"sync/atomic"
)

// Bootstrap deliberately does not consume durable deliveries. Issue #21 owns
// the PostgreSQL handoff and persistence boundary required by ADR-0023.
type Bootstrap struct {
	started atomic.Bool
}

func NewBootstrap() *Bootstrap {
	return &Bootstrap{}
}

func (bootstrap *Bootstrap) Start(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	bootstrap.started.Store(true)
	return nil
}

func (bootstrap *Bootstrap) Close() {
	bootstrap.started.Store(false)
}

func (bootstrap *Bootstrap) Ready() bool {
	return bootstrap.started.Load()
}
