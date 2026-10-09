`legacy-v1.zip` is a fixed, hand-authored compatibility package (not generated
by the current exporter). It contains a June 2026 related employee/department,
legacy annual manager corrections and overtime rows without newer source/manual
flags. It omits meal datasets, accounts, active state and monthly snapshots.
The manifest checksum binds its original data.json bytes. Keep these bytes fixed
when evolving the exporter; extend compatibility tests rather than regenerating
this archive. It contains synthetic identities and no real password or files.
