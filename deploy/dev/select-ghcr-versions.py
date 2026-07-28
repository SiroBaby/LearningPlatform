#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# ///
# ─── How to run ───
# python3 deploy/dev/select-ghcr-versions.py --versions versions.json --protected-digests protected.txt --as-of 2026-07-28T00:00:00Z
"""Select only safe, exact GHCR container version IDs for deletion."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Final

SHA_TAG: Final = re.compile(r"sha-[0-9a-f]{40}\Z")
DIGEST: Final = re.compile(r"sha256:[0-9a-f]{64}\Z")
KEEP_COUNT: Final = 10
MINIMUM_AGE: Final = timedelta(days=30)


class SelectionError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Version:
    created_at: datetime
    digest: str
    version_id: int


def parse_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise SelectionError(f"invalid created_at: {value!r}") from error
    if parsed.tzinfo is None:
        raise SelectionError(f"created_at must include timezone: {value!r}")
    return parsed.astimezone(UTC)


def parse_version(raw: dict[str, object]) -> Version | None:
    version_id = raw.get("id")
    digest = raw.get("name")
    created_at = raw.get("created_at")
    metadata = raw.get("metadata")
    if not isinstance(version_id, int) or version_id <= 0:
        return None
    if not isinstance(digest, str) or not DIGEST.fullmatch(digest):
        return None
    if not isinstance(created_at, str):
        return None
    try:
        created = parse_timestamp(created_at)
    except SelectionError:
        return None
    if not isinstance(metadata, dict):
        return None
    container = metadata.get("container")
    if not isinstance(container, dict):
        return None
    tags = container.get("tags")
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        return None
    if len(tags) != 1 or SHA_TAG.fullmatch(tags[0]) is None:
        return None
    return Version(created_at=created, digest=digest, version_id=version_id)


def parse_protected_digests(path: Path) -> frozenset[str]:
    digests = frozenset(line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip())
    if not all(DIGEST.fullmatch(digest) for digest in digests):
        raise SelectionError("protected digest list contains malformed data")
    return digests


def select_deletable_ids(raw_versions: list[dict[str, object]], protected: frozenset[str], as_of: datetime) -> list[int]:
    eligible = [version for raw in raw_versions if (version := parse_version(raw)) is not None]
    ordered = sorted(eligible, key=lambda version: (version.created_at, version.version_id), reverse=True)
    cutoff = as_of - MINIMUM_AGE
    return [
        version.version_id
        for version in ordered[KEEP_COUNT:]
        if version.created_at <= cutoff and version.digest not in protected
    ]


def load_versions(path: Path) -> list[dict[str, object]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SelectionError("versions payload is not valid JSON") from error
    if not isinstance(payload, list) or not all(isinstance(item, dict) for item in payload):
        raise SelectionError("versions payload must be an array of objects")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--versions", required=True, type=Path)
    parser.add_argument("--protected-digests", required=True, type=Path)
    parser.add_argument("--as-of", required=True)
    arguments = parser.parse_args()
    try:
        as_of = parse_timestamp(arguments.as_of)
        version_ids = select_deletable_ids(
            load_versions(arguments.versions),
            parse_protected_digests(arguments.protected_digests),
            as_of,
        )
    except (OSError, SelectionError) as error:
        print(f"GHCR retention selection failed closed: {error}", file=sys.stderr)
        return 1
    print(*version_ids, sep="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
