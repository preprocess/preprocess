export type ClientApiSession = {
  token: string;
  organizationId: string;
};

export type ClientOrganization = {
  id: string;
  name: string;
  isCurrent: boolean;
};

export type OAuthProvider =
  "AppleOAuth" | "GithubOAuth" | "GoogleOAuth" | "MicrosoftOAuth";

export type ConnectedAccount = {
  email?: string | null;
  provider: string;
};
