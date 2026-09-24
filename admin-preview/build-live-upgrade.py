"""Build the private admin upgrade as one transaction in dependency order.

This only writes SQL; it never connects to a database or reads credentials.
"""
import argparse
from pathlib import Path

SQL_ROOT = Path(__file__).resolve().parents[1] / "supabase"
FILES = (
    "admin-live-query-performance.sql",
    "admin-live-provider-aliases.sql",
    "admin-live-configuration.sql",
    "admin-live-configuration-platforms.sql",
    "admin-live-configuration-query.sql",
    "admin-live-configuration-workorders.sql",
    "admin-live-withdraw-pages.sql",
    "admin-live-withdraw-templates.sql",
    "admin-live-withdraw-reasons.sql",
    "admin-live-withdraw-notes.sql",
)


def build():
    parts = ["-- Private admin release 2026-09-24. Atomic: a failure rolls back the entire upgrade.\nbegin;\n"]
    for name in FILES:
        lines = (SQL_ROOT / name).read_text().splitlines()
        if lines.count("begin;") != 1 or lines.count("commit;") != 1:
            raise ValueError(f"Unexpected transaction boundaries: {name}")
        parts.append(f"\n-- FILE: {name}\n" + "\n".join(line for line in lines if line not in ("begin;", "commit;")))
    parts.append("\ncommit;\nselect 'admin-ui-20260924-v3' as applied_release;\n")
    return "\n".join(parts)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(build())
    print(f"Wrote atomic upgrade ({len(FILES)} files): {args.output}")
