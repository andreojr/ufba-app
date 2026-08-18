export interface GoogleUserInfo {
  googleId: string;
  email: string;
  name: string;
}

export interface Session {
  accessToken: string;
  user: GoogleUserInfo;
}
