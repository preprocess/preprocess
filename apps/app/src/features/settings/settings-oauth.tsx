import type {
  ConnectedAccount,
  OAuthProvider,
} from "../workos-client-api/types";

const OAUTH_LABELS = {
  AppleOAuth: "Apple",
  GithubOAuth: "GitHub",
  GoogleOAuth: "Google",
  MicrosoftOAuth: "Microsoft",
} as const satisfies Record<OAuthProvider, string>;

function isOAuthProvider(value: string): value is OAuthProvider {
  return value in OAUTH_LABELS;
}

export function oauthAccounts(accounts: ConnectedAccount[] | null | undefined) {
  if (!accounts) return [];
  return accounts.flatMap((account) =>
    isOAuthProvider(account.provider)
      ? [{ email: account.email, provider: account.provider }]
      : [],
  );
}

export function oauthLabel(provider: OAuthProvider) {
  return OAUTH_LABELS[provider];
}

export function OAuthMark({ provider }: { provider: OAuthProvider }) {
  switch (provider) {
    case "GoogleOAuth":
      return (
        <svg
          aria-hidden="true"
          fill="none"
          height="16"
          viewBox="0 0 16 16"
          width="16"
        >
          <path
            d="M15.83 8.18C15.83 7.65333 15.7833 7.15333 15.7033 6.66667H8.17V9.67333H12.4833C12.29 10.66 11.7233 11.4933 10.8833 12.06V14.06H13.4567C14.9633 12.6667 15.83 10.6133 15.83 8.18Z"
            fill="#4285F4"
          />
          <path
            d="M8.17 16C10.33 16 12.1367 15.28 13.4567 14.06L10.8833 12.06C10.1633 12.54 9.25 12.8333 8.17 12.8333C6.08334 12.8333 4.31667 11.4267 3.68334 9.52667H1.03V11.5867C2.34334 14.2 5.04334 16 8.17 16Z"
            fill="#34A853"
          />
          <path
            d="M3.68334 9.52667C3.51667 9.04667 3.43 8.53333 3.43 8C3.43 7.46667 3.52334 6.95334 3.68334 6.47334V4.41334H1.03C0.483335 5.49334 0.170002 6.70667 0.170002 8C0.170002 9.29333 0.483335 10.5067 1.03 11.5867L3.68334 9.52667Z"
            fill="#FBBC05"
          />
          <path
            d="M8.17 3.16667C9.35 3.16667 10.4033 3.57334 11.2367 4.36667L13.5167 2.08667C12.1367 0.793334 10.33 0 8.17 0C5.04334 0 2.34334 1.8 1.03 4.41334L3.68334 6.47334C4.31667 4.57334 6.08334 3.16667 8.17 3.16667Z"
            fill="#EA4335"
          />
        </svg>
      );
    case "GithubOAuth":
      return (
        <svg aria-hidden="true" height="16" viewBox="0 0 15 15" width="16">
          <path
            clipRule="evenodd"
            d="M7.49933 0.25C3.49635 0.25 0.25 3.49593 0.25 7.50024C0.25 10.703 2.32715 13.4206 5.2081 14.3797C5.57084 14.446 5.70302 14.2222 5.70302 14.0299C5.70302 13.8576 5.69679 13.4019 5.69323 12.797C3.67661 13.235 3.25112 11.825 3.25112 11.825C2.92132 10.9874 2.44599 10.7644 2.44599 10.7644C1.78773 10.3149 2.49584 10.3238 2.49584 10.3238C3.22353 10.375 3.60629 11.0711 3.60629 11.0711C4.25298 12.1788 5.30335 11.8588 5.71638 11.6732C5.78225 11.205 5.96962 10.8854 6.17658 10.7043C4.56675 10.5209 2.87415 9.89918 2.87415 7.12104C2.87415 6.32925 3.15677 5.68257 3.62053 5.17563C3.54576 4.99226 3.29697 4.25521 3.69174 3.25691C3.69174 3.25691 4.30015 3.06196 5.68522 3.99973C6.26337 3.83906 6.8838 3.75895 7.50022 3.75583C8.1162 3.75895 8.73619 3.83906 9.31523 3.99973C10.6994 3.06196 11.3069 3.25691 11.3069 3.25691C11.7026 4.25521 11.4538 4.99226 11.3795 5.17563C11.8441 5.68257 12.1245 6.32925 12.1245 7.12104C12.1245 9.9063 10.4292 10.5192 8.81452 10.6985C9.07444 10.9224 9.30633 11.3648 9.30633 12.0413C9.30633 13.0102 9.29742 13.7922 9.29742 14.0299C9.29742 14.2239 9.42828 14.4496 9.79591 14.3788C12.6746 13.4179 14.75 10.7025 14.75 7.50024C14.75 3.49593 11.5036 0.25 7.49933 0.25Z"
            fill="currentColor"
            fillRule="evenodd"
          />
        </svg>
      );
    case "MicrosoftOAuth":
      return (
        <svg aria-hidden="true" height="16" viewBox="0 0 15 15" width="16">
          <path d="M0 0H7V7H0V0Z" fill="#F35325" />
          <path d="M8 0H15V7H8V0Z" fill="#81BC06" />
          <path d="M0 8H7V15H0V8Z" fill="#05A6F0" />
          <path d="M8 8H15V15H8V8Z" fill="#FFBA08" />
        </svg>
      );
    case "AppleOAuth":
      return (
        <svg aria-hidden="true" height="16" viewBox="0 0 15 16" width="16">
          <path
            d="M10.1.1C10.65-.55 11.03-1.46 11.03-2.37V-2.73C10.11-2.69 9.05-2.13 8.41-1.38C7.91-.8 7.44.11 7.44 1.03V1.35C7.53 1.36 7.62 1.38 7.71 1.38C8.51 1.38 9.52.84 10.1.11ZM14.22 3.34C14.12 3.42 12.31 4.44 12.31 6.73C12.31 9.37 14.61 10.3 14.68 10.32C14.67 10.38 14.31 11.6 13.47 12.85C12.71 13.94 11.93 15.04 10.73 15.04C9.53 15.04 9.22 14.33 7.84 14.33C6.49 14.33 6.01 15.06 4.92 15.06C3.82 15.06 3.06 14.05 2.18 12.8C1.16 11.34.34 9.07.34 6.91C.34 3.45 2.57 1.62 4.76 1.62C5.92 1.62 6.89 2.39 7.62 2.39C8.32 2.39 9.4 1.57 10.73 1.57C11.23 1.57 13.03 1.62 14.22 3.34Z"
            fill="currentColor"
          />
        </svg>
      );
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
