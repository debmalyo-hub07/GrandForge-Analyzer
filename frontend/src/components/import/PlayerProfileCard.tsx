// src/components/import/PlayerProfileCard.tsx
import type { PlayerProfile } from '../../store/importStore';

interface PlayerProfileCardProps {
  profile: PlayerProfile;
}

export function PlayerProfileCard({ profile }: PlayerProfileCardProps) {
  const initial = profile.username.charAt(0).toUpperCase();
  return (
    <div className="player-profile-card">
      <div className="player-avatar">
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt={profile.username} />
        ) : (
          <span className="player-avatar-fallback">{initial}</span>
        )}
      </div>
      <div className="player-profile-body">
        <div className="player-profile-name-row">
          {profile.title && <span className="player-title-badge">{profile.title}</span>}
          <span className="player-username">{profile.username}</span>
          {profile.country && <span className="player-country">{profile.country}</span>}
        </div>
        <div className="player-profile-meta">
          {profile.rating !== undefined && (
            <span className="player-rating">Rating · {profile.rating}</span>
          )}
          {profile.totalGames !== undefined && (
            <span className="player-total-games">{profile.totalGames} games</span>
          )}
          <span className="player-platform">
            {profile.platform === 'chesscom' ? 'Chess.com' : 'Lichess'}
          </span>
        </div>
        {profile.url && (
          <a
            href={profile.url}
            target="_blank"
            rel="noopener noreferrer"
            className="player-profile-link"
          >
            View profile ↗
          </a>
        )}
      </div>
    </div>
  );
}
