import type { RestoreArgs } from "../../types";

/** Everything the restore wizard collects, independent of React state. */
export interface RestoreForm {
  version: string;
  dbName: string;
  backupFile: string;
  dropExisting: boolean;
  deactivateCron: boolean;
  neutralize: boolean;
  anonymize: boolean;
  wipe: boolean;
  purgeMasterData: boolean;
  purgeTransactions: boolean;
  anonymizeUsers: boolean;
  userPassword: string;
  uninstallModules: string;
  recompute: boolean;
  checkSpace: boolean;
}

/** The five options the CLI's `--sanitize` switches on in one go. */
export const SANITIZE_CHILDREN = [
  "deactivateCron",
  "neutralize",
  "anonymize",
  "wipe",
  "purgeMasterData",
] as const;

/**
 * Translate the wizard state into `odoodev db restore` arguments.
 *
 * Two CLI defaults make omission dangerous rather than neutral, so both are
 * always sent explicitly:
 *
 * * `--drop/--no-drop` defaults to *drop* — omitting it would silently
 *   overwrite the target database.
 * * `--recompute/--no-recompute` defaults to the value of `anonymize`, so an
 *   unchecked box would still recompute whenever anonymize runs. The flag is
 *   only meaningful together with anonymize (the CLI skips the step otherwise),
 *   hence it is omitted entirely when anonymize is off.
 *
 * The remaining options are opt-in and default to off, so sending the positive
 * flag alone is enough.
 *
 * `--sanitize` itself is deliberately never sent: it would pull in
 * `--purge-master-data`, which deletes customers, vendors and CRM/HR data. The
 * wizard's "sanitize" switch is a pure toggle-all over the five children.
 */
export function buildRestoreArgs(form: RestoreForm, dry: boolean): RestoreArgs {
  return {
    version: form.version,
    name: form.dbName,
    backup_file: form.backupFile,
    drop: form.dropExisting,
    deactivate_cron: form.deactivateCron || undefined,
    neutralize: form.neutralize || undefined,
    anonymize: form.anonymize || undefined,
    wipe: form.wipe || undefined,
    purge_master_data: form.purgeMasterData || undefined,
    purge_transactions: form.purgeTransactions || undefined,
    anonymize_users: form.anonymizeUsers || undefined,
    user_password: form.anonymizeUsers ? form.userPassword : undefined,
    uninstall_modules: form.uninstallModules || undefined,
    recompute: form.anonymize ? form.recompute : undefined,
    check_space: form.checkSpace ? undefined : false,
    dry_run: dry || undefined,
  };
}
