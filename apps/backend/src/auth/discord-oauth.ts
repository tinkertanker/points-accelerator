import { AppError } from "../utils/app-error.js";

export type DiscordIdentity = {
  id: string;
  username: string;
  globalName: string | null;
  avatarUrl: string | null;
};

export interface DiscordOAuthClient {
  buildAuthorizeUrl(params: { state: string; redirectUri: string }): string;
  exchangeCode(params: { code: string; redirectUri: string }): Promise<DiscordIdentity>;
}

type DiscordTokenResponse = {
  access_token?: string;
};

type DiscordUserResponse = {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
};

export function createDiscordOAuthClient(params: {
  applicationId?: string;
  clientSecret?: string;
}): DiscordOAuthClient | null {
  const { applicationId, clientSecret } = params;
  if (!applicationId || !clientSecret) {
    return null;
  }

  return {
    buildAuthorizeUrl({ state, redirectUri }) {
      const url = new URL("https://discord.com/oauth2/authorize");
      url.search = new URLSearchParams({
        client_id: applicationId,
        response_type: "code",
        scope: "identify",
        state,
        redirect_uri: redirectUri,
        prompt: "consent",
      }).toString();
      return url.toString();
    },

    async exchangeCode({ code, redirectUri }) {
      const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: applicationId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw new AppError("Discord login failed during token exchange.", 502);
      }

      const tokenPayload = (await tokenResponse.json()) as DiscordTokenResponse;
      if (!tokenPayload.access_token) {
        throw new AppError("Discord login did not return an access token.", 502);
      }

      const identityResponse = await fetch("https://discord.com/api/users/@me", {
        headers: {
          Authorization: `Bearer ${tokenPayload.access_token}`,
        },
      });

      if (!identityResponse.ok) {
        throw new AppError("Discord login failed while fetching your profile.", 502);
      }

      const identity = (await identityResponse.json()) as DiscordUserResponse;
      return {
        id: identity.id,
        username: identity.username,
        globalName: identity.global_name,
        avatarUrl: identity.avatar ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png?size=128` : null,
      };
    },
  };
}
