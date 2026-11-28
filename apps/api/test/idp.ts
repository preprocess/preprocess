// Where the fake identity provider (fake-idp.ts) answers, for tests and the
// test Worker's outbound service alike.
export const IDP = "https://idp.test";
export const SAML_ENTITY = `${IDP}/saml`;
export const SAML_SSO_URL = `${IDP}/saml/sso`;
