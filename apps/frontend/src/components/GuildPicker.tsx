import type { GuildSummary } from "../types";

type GuildPickerProps = {
  guilds: GuildSummary[];
  isBusy: boolean;
  onSelect: (guildId: string) => void;
  onAddAnother?: () => void;
  onLogout?: () => void;
};

export default function GuildPicker({ guilds, isBusy, onSelect, onAddAnother, onLogout }: GuildPickerProps) {
  return (
    <section className="login-page">
      <header className="login-hero">
        <h1 className="brand-title">
          <img src="/favicon-32x32.png" alt="" aria-hidden="true" className="brand-title__icon brand-title__icon--hero" />
          <span>points accelerator</span>
        </h1>
        <p className="lede">Choose the Discord server you'd like to manage.</p>
      </header>

      <article className="login-card">
        <h2>Pick a server</h2>
        {guilds.length === 0 ? (
          <p>
            You aren't a member of any Discord server where this bot is installed. Ask an admin to invite the bot, or
            add it to a server you own first.
          </p>
        ) : (
          <ul className="guild-picker-list">
            {guilds.map((guild) => (
              <li key={guild.guildId}>
                <button
                  type="button"
                  className="guild-picker-row"
                  disabled={isBusy}
                  onClick={() => onSelect(guild.guildId)}
                >
                  {guild.iconUrl ? (
                    <img src={guild.iconUrl} alt="" className="guild-picker-icon" />
                  ) : (
                    <span className="guild-picker-icon guild-picker-icon--placeholder" aria-hidden="true">
                      {guild.name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="guild-picker-name">{guild.name}</span>
                  <span className="guild-picker-id">{guild.guildId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="guild-picker-actions">
          {onAddAnother ? (
            <button type="button" onClick={onAddAnother} disabled={isBusy}>
              Add the bot to another server
            </button>
          ) : null}
          {onLogout ? (
            <button type="button" className="secondary" onClick={onLogout} disabled={isBusy}>
              Sign out
            </button>
          ) : null}
        </div>
      </article>
    </section>
  );
}
