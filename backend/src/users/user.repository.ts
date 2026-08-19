export interface UserRecord {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  matricula: string | null;
  curso: string | null;
  periodoIngresso: string | null;
}

/**
 * Academic identity scraped from the SIGAA portal home. Fields are null when
 * the page didn't yield them — null means "don't touch what's stored", so a
 * partial scrape never erases previously captured data.
 */
export interface SigaaProfileUpdate {
  matricula: string | null;
  curso: string | null;
  periodoIngresso: string | null;
}

export interface UserRepository {
  /**
   * Finds the user by Google identity, creating it on first login. `googleId`
   * is only ever used as the lookup/create key here — every other part of the
   * app addresses the user by `UserRecord.id`, never by `googleId`.
   */
  upsertGoogleUser(input: {
    googleId: string;
    email: string;
    name: string;
  }): Promise<UserRecord>;

  findById(userId: string): Promise<UserRecord | null>;

  updateAvatarUrl(userId: string, avatarUrl: string): Promise<void>;

  /** Persists the non-null fields of a scraped SIGAA profile; no-ops when all are null. */
  updateSigaaProfile(
    userId: string,
    profile: SigaaProfileUpdate,
  ): Promise<void>;
}
