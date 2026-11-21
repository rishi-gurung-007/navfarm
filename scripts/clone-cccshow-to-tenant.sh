#!/usr/bin/env bash
# Rewrites cccshow's tenant_id in a raw data-only dump (produced locally from
# nf_cccshow, since cccshow only exists on the dev machine) to a target
# tenant's own tenant_id, then restores it into that tenant's existing
# database. Reusable: run it again with a different target tenant_id /
# database to clone into any other tenant.
#
# The dump is DATA ONLY (--no-create-info --complete-insert --insert-ignore,
# __drizzle_migrations excluded) - it never touches the target's schema or
# its own migration history, matching the pattern already used for the
# nf_ccc reconciliation on 16 Nov. INSERT IGNORE means rows that collide on
# primary key with something already in the target (e.g. the shared system
# reference tables - nob_master, lob_master, country_master, role_master,
# etc., which carry no tenant_id and are identical in every tenant) are
# silently skipped rather than erroring.
#
# company_id, nob_id and lob_id are NOT rewritten: a freshly onboarded
# tenant's company keeps the standard zero id
# (00000000-0000-0000-0000-000000000000), and NOB/LOB are global system
# rows - both already match between cccshow and any other tenant.
#
# BACK UP THE TARGET DATABASE BEFORE RUNNING THIS. It is not reversible by
# this script.
#
# Usage:
#   ./clone-cccshow-to-tenant.sh <dump_file> <target_tenant_id> <target_database> [mysql_user]
#
# Find the target tenant_id first:
#   mysql -u root -p -e "SELECT tenant_id, db_name FROM nf_master.tenant_master WHERE tenant_code='<code>';"

set -euo pipefail

DUMP_FILE="${1:?Usage: clone-cccshow-to-tenant.sh <dump_file> <target_tenant_id> <target_database> [mysql_user]}"
TARGET_TENANT_ID="${2:?Target tenant_id required}"
TARGET_DATABASE="${3:?Target database name required}"
MYSQL_USER="${4:-root}"
SOURCE_TENANT_ID="f70a44ef-4dfb-4724-b1fb-ed7f9ef23718"  # cccshow's own tenant_id - fixed, do not change

if [ ! -f "$DUMP_FILE" ]; then
  echo "Dump file not found: $DUMP_FILE" >&2
  exit 1
fi
if ! [[ "$TARGET_TENANT_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
  echo "TARGET_TENANT_ID doesn't look like a UUID: $TARGET_TENANT_ID" >&2
  exit 1
fi

REWRITTEN="${DUMP_FILE}.for-${TARGET_TENANT_ID}.sql"
echo "Rewriting tenant_id ${SOURCE_TENANT_ID} -> ${TARGET_TENANT_ID} ..."
sed "s/${SOURCE_TENANT_ID}/${TARGET_TENANT_ID}/g" "$DUMP_FILE" > "$REWRITTEN"
echo "Rewritten file: $REWRITTEN"

echo
echo "About to INSERT (IGNORE on conflict) cccshow's full dataset into database '${TARGET_DATABASE}'."
echo "Make sure you have already backed up ${TARGET_DATABASE} - this is not reversible by this script."
read -r -p "Type the database name again to confirm: " CONFIRM
if [ "$CONFIRM" != "$TARGET_DATABASE" ]; then
  echo "Confirmation did not match '${TARGET_DATABASE}'; aborting without restoring anything." >&2
  exit 1
fi

echo "Restoring into ${TARGET_DATABASE} ..."
# Redirecting the dump into stdin and an interactive -p password prompt both
# want stdin, so the password goes through MYSQL_PWD instead.
if [ -z "${MYSQL_PWD:-}" ]; then
  read -r -s -p "MySQL password for ${MYSQL_USER}: " MYSQL_PWD
  echo
  export MYSQL_PWD
fi
mysql -u "$MYSQL_USER" "$TARGET_DATABASE" < "$REWRITTEN"
unset MYSQL_PWD
echo "Restore complete."
