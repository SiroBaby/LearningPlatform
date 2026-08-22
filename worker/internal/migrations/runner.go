package migrations

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

const advisoryLockKey int64 = 4815162342

// Run applies the same tracked SQL migrations as the Node composition roots.
// It holds one session-level lock so API and Go worker startup serialize safely.
func Run(ctx context.Context, conn *pgx.Conn, directory string) error {
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", advisoryLockKey); err != nil {
		return fmt.Errorf("acquire migration advisory lock: %w", err)
	}
	defer conn.Exec(context.Background(), "SELECT pg_advisory_unlock($1)", advisoryLockKey)
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS public.schema_migrations (version varchar(40) PRIMARY KEY, name varchar(200) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("ensure migration tracking table: %w", err)
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return fmt.Errorf("read migration directory: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".up.sql") {
			names = append(names, strings.TrimSuffix(entry.Name(), ".up.sql"))
		}
	}
	sort.Strings(names)
	for _, name := range names {
		version, _, ok := strings.Cut(name, "_")
		if !ok {
			return fmt.Errorf("invalid migration name %q", name)
		}
		var exists bool
		if err := conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM public.schema_migrations WHERE version=$1)`, version).Scan(&exists); err != nil {
			return fmt.Errorf("read applied migrations: %w", err)
		}
		if exists {
			continue
		}
		sql, readErr := os.ReadFile(filepath.Join(directory, name+".up.sql"))
		if readErr != nil {
			return fmt.Errorf("read migration %s: %w", name, readErr)
		}
		tx, beginErr := conn.Begin(ctx)
		if beginErr != nil {
			return fmt.Errorf("begin migration %s: %w", name, beginErr)
		}
		if _, execErr := tx.Exec(ctx, string(sql)); execErr != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, execErr)
		}
		if _, insertErr := tx.Exec(ctx, `INSERT INTO public.schema_migrations(version,name) VALUES($1,$2)`, version, name); insertErr != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, insertErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return fmt.Errorf("commit migration %s: %w", name, commitErr)
		}
	}
	return nil
}
