import type { Campaign, Settings, SheetLayout } from '../../services/types';
import { chronicle, humanize, partyTracks, sceneEntries } from './asideModel';

export default function PlayAside({
  campaign,
  options,
  layout,
}: {
  campaign: Campaign;
  options: Settings | null;
  layout?: SheetLayout;
}) {
  const players = campaign.characters.filter(
    (character) =>
      options?.characterTypeOptions.find((role) => role.id === character.type)?.default === true
  );
  const scene = sceneEntries(campaign.state);
  const kinds = chronicle(campaign.knowledge ?? [], options?.knowledgeKindOptions ?? []);
  return (
    <>
      {players.length > 0 && (
        <section aria-labelledby="aside-party" className="aside-section">
          <h3 id="aside-party">Party</h3>
          <ul className="aside-party">
            {players.map((player) => (
              <li key={player.id}>
                <strong>{player.name}</strong>
                {partyTracks(player, campaign.state, layout).map((track) => (
                  <div key={track.key} className="aside-track">
                    <span>{track.label}</span>
                    {track.max !== null ? (
                      <>
                        <span
                          className="sheet-track-bar"
                          role="meter"
                          aria-label={`${player.name} ${track.label}`}
                          aria-valuemin={0}
                          aria-valuemax={track.max}
                          aria-valuenow={Math.max(0, Math.min(track.value, track.max))}
                        >
                          <span
                            style={{
                              width: `${track.max > 0 ? (Math.max(0, Math.min(track.value, track.max)) / track.max) * 100 : 0}%`,
                            }}
                          />
                        </span>
                        <span>
                          {track.value} / {track.max}
                        </span>
                      </>
                    ) : (
                      <span>{track.value}</span>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
      {scene.length > 0 && (
        <section aria-labelledby="aside-scene" className="aside-section">
          <h3 id="aside-scene">Scene</h3>
          <dl className="aside-scene">
            {scene.map(([key, value]) => (
              <div key={key}>
                <dt>{humanize(key)}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      {kinds.length > 0 && (
        <section aria-labelledby="aside-chronicle" className="aside-section">
          <h3 id="aside-chronicle">Chronicle</h3>
          {kinds.map((kind) => (
            <div key={kind.id}>
              <h4>{kind.label}</h4>
              <ul className="aside-chronicle">
                {kind.records.map((record) => (
                  <li key={record.id}>{record.title}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
