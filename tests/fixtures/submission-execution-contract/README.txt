Portable submission cohort test fixture

Entry: require('./index.cjs').initialize()
Returns {db, f, query, call, drain}; the caller closes db.

This directory contains the existing synthetic source setup and seed rows,
the real submission day kernel, projection, read/admission/compute wrappers,
and the queue/artifact schema those tests use. Native source metadata has
been reduced to CREATE TABLE column declarations. No production receipts,
rows, credentials, repository parent paths, or network calls are required.

The fixture depends only on Node built-ins and the repository's existing
@electric-sql/pglite package. source-sql preserves the original source-test
setup migrations in their original order; these are test bootstrap inputs,
not deployment operations. The actual cohort SQL is loaded from this same
directory. All identifiers in seeded rows are synthetic.
