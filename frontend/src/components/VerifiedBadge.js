import React from 'react';

function VerifiedBadge({ className = '', title = 'Verified account' }) {
  return (
    <span className={`verified-badge ${className}`.trim()} title={title} aria-label={title}>
      <span className="verified-badge__icon">✓</span>
      <span className="verified-badge__text">Verified</span>
    </span>
  );
}

export default VerifiedBadge;