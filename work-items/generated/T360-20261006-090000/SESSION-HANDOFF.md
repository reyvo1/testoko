# P6B session handoff

Base P6A: d07446c6edac764aa32a3231b42faafa17913a63.
Branch feature/T360-20261006-090000-p6b-retail-products.
Read handoff/CURRENT-WORK.md latest P6B block and docs/P6-RETAIL-EXPANSION.md.
Tests must set RUST_LOG=info. Candidate gate must set DATABASE_URL to explicit /tmp scratch SQLite and DATABASE_PROFILE=sqlite/T360_ENVIRONMENT=test. Preserve operator .env/database.
