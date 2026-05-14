const { createCanvas } = require('@napi-rs/canvas');

// Colors
const BG = '#1e2124';
const LINE = '#4a5568';
const TEXT_DEFAULT = '#ffffff';
const TEXT_WIN = '#43b581';   // green - winner
const TEXT_BYE = '#faa61a';   // yellow - bye
const TEXT_PENDING = '#99aab5'; // grey - pending
const BOX_BG = '#2c2f33';
const BOX_BORDER = '#23272a';
const WIN_BOX = '#1a3a2a';
const HEADER_COLOR = '#7289da';

const SLOT_H = 36;
const SLOT_W = 160;
const PAIR_GAP = 16;   // gap between two players in a match
const MATCH_GAP = 40;  // gap between matches in same round
const ROUND_GAP = 80;  // horizontal gap between rounds
const PADDING = 40;

function getMatchY(matchIndex, round, totalRounds) {
  // Each round doubles the spacing between matches
  const spacing = (SLOT_H * 2 + PAIR_GAP + MATCH_GAP) * Math.pow(2, round);
  return PADDING + matchIndex * spacing;
}

function getMatchX(round) {
  return PADDING + round * (SLOT_W + ROUND_GAP);
}

function getRoundsFromBracket(bracket) {
  return bracket;
}

function drawRoundedRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke(); }
}

function drawPlayer(ctx, x, y, name, isWinner, isBye, isPending) {
  const bg = isWinner ? WIN_BOX : BOX_BG;
  const border = isWinner ? TEXT_WIN : BOX_BORDER;
  drawRoundedRect(ctx, x, y, SLOT_W, SLOT_H, 4, bg, border);

  ctx.font = isWinner ? 'bold 13px sans-serif' : '13px sans-serif';
  ctx.textBaseline = 'middle';

  let color = TEXT_DEFAULT;
  if (isWinner) color = TEXT_WIN;
  else if (isBye) color = TEXT_BYE;
  else if (isPending) color = TEXT_PENDING;

  ctx.fillStyle = color;
  const displayName = name ? (name.length > 18 ? name.slice(0, 16) + '…' : name) : '???';
  ctx.fillText(displayName, x + 10, y + SLOT_H / 2);

  if (isWinner) {
    ctx.fillStyle = TEXT_WIN;
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('✓', x + SLOT_W - 20, y + SLOT_H / 2);
  }
}

function drawConnector(ctx, x1, y1, x2, y2) {
  const midX = (x1 + x2) / 2;
  ctx.beginPath();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.moveTo(x1, y1);
  ctx.lineTo(midX, y1);
  ctx.lineTo(midX, y2);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function buildBracketImage(bracket, currentRound, matchDisplayNames) {
  const rounds = bracket.length;
  const maxMatchesInRound0 = bracket[0].length;

  const height = Math.max(400,
    PADDING * 2 + maxMatchesInRound0 * (SLOT_H * 2 + PAIR_GAP + MATCH_GAP)
  );
  const width = PADDING * 2 + rounds * (SLOT_W + ROUND_GAP) + SLOT_W + 60;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // Round headers
  for (let r = 0; r < rounds; r++) {
    const x = getMatchX(r);
    ctx.fillStyle = HEADER_COLOR;
    ctx.font = 'bold 13px sans-serif';
    ctx.textBaseline = 'top';
    const label = r === rounds - 1 && rounds > 1 ? '🏆 Final' : `Round ${r + 1}`;
    ctx.fillText(label, x, 10);
  }

  // Track center-Y of each match per round for connectors
  const matchCenters = bracket.map(() => []);

  for (let r = 0; r < rounds; r++) {
    const round = bracket[r];
    const x = getMatchX(r);

    for (let m = 0; m < round.length; m++) {
      const match = round[m];

      // Calculate Y position — space doubles each round
      const baseSpacing = SLOT_H * 2 + PAIR_GAP + MATCH_GAP;
      const spacing = baseSpacing * Math.pow(2, r);
      const offset = r > 0 ? spacing / 2 - baseSpacing / 2 : 0;
      const y = PADDING + 30 + m * spacing + offset;

      const centerY = y + SLOT_H + PAIR_GAP / 2;
      matchCenters[r].push(centerY);

      if (match.bye) {
        // Bye: single slot
        const name = matchDisplayNames?.[r]?.[m]?.p1 || match.p1Tag || match.p1?.slice(-4) || 'BYE';
        drawPlayer(ctx, x, y, `${name} (BYE)`, false, true, false);

        // Divider line
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y + SLOT_H + PAIR_GAP / 2);
        ctx.lineTo(x + SLOT_W, y + SLOT_H + PAIR_GAP / 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const p1Name = matchDisplayNames?.[r]?.[m]?.p1 || match.p1Tag || match.p1?.slice(-4) || '???';
        const p2Name = matchDisplayNames?.[r]?.[m]?.p2 || match.p2Tag || match.p2?.slice(-4) || '???';
        const p1Won = match.winner === match.p1;
        const p2Won = match.winner === match.p2;
        const pending = !match.winner;

        drawPlayer(ctx, x, y, p1Name, p1Won, false, pending);
        drawPlayer(ctx, x, y + SLOT_H + PAIR_GAP, p2Name, p2Won, false, pending);

        // Divider between players
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 5, y + SLOT_H + PAIR_GAP / 2);
        ctx.lineTo(x + SLOT_W - 5, y + SLOT_H + PAIR_GAP / 2);
        ctx.stroke();

        // Connector line to right
        if (r < rounds - 1) {
          const rightX = getMatchX(r + 1);
          const midOutY = y + SLOT_H + PAIR_GAP / 2;
          ctx.strokeStyle = LINE;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + SLOT_W, midOutY);
          ctx.lineTo(x + SLOT_W + (ROUND_GAP / 2), midOutY);
          ctx.stroke();
        }
      }
    }

    // Draw connectors from two matches to the next round match
    if (r < rounds - 1) {
      const nextRound = bracket[r + 1];
      for (let nm = 0; nm < nextRound.length; nm++) {
        const srcM1 = nm * 2;
        const srcM2 = nm * 2 + 1;
        if (matchCenters[r][srcM1] !== undefined) {
          const x1 = getMatchX(r) + SLOT_W + ROUND_GAP / 2;
          const x2 = getMatchX(r + 1);

          const baseSpacing = SLOT_H * 2 + PAIR_GAP + MATCH_GAP;
          const spacing = baseSpacing * Math.pow(2, r + 1);
          const offset = (r + 1) > 0 ? spacing / 2 - baseSpacing / 2 : 0;
          const targetY = PADDING + 30 + nm * spacing + offset + SLOT_H + PAIR_GAP / 2;

          const y1 = matchCenters[r][srcM1];
          const y2 = matchCenters[r][srcM2] !== undefined ? matchCenters[r][srcM2] : y1;
          const midY = (y1 + (y2 || y1)) / 2;

          ctx.strokeStyle = LINE;
          ctx.lineWidth = 2;
          ctx.beginPath();
          // From match 1
          ctx.moveTo(x1, y1);
          ctx.lineTo(x1 + ROUND_GAP / 2 - 4, y1);
          ctx.lineTo(x1 + ROUND_GAP / 2 - 4, midY);
          // From match 2 if exists
          if (matchCenters[r][srcM2] !== undefined) {
            ctx.moveTo(x1, y2);
            ctx.lineTo(x1 + ROUND_GAP / 2 - 4, y2);
            ctx.lineTo(x1 + ROUND_GAP / 2 - 4, midY);
          }
          // To next round
          ctx.moveTo(x1 + ROUND_GAP / 2 - 4, midY);
          ctx.lineTo(x2, midY);
          ctx.stroke();
        }
      }
    }
  }

  // Champion box if tournament complete
  const lastRound = bracket[rounds - 1];
  const champion = lastRound?.find(m => m.winner && (lastRound.length === 1 || rounds > 1));
  if (champion?.winner && lastRound.length === 1) {
    const rx = getMatchX(rounds);
    const baseSpacing = SLOT_H * 2 + PAIR_GAP + MATCH_GAP;
    const spacing = baseSpacing * Math.pow(2, rounds - 1);
    const ry = PADDING + 30 + spacing / 2 - baseSpacing / 2 + SLOT_H + PAIR_GAP / 2 - SLOT_H / 2;
    const champName = matchDisplayNames?.[rounds - 1]?.[0]?.winner || champion.p1Tag || champion.p1?.slice(-4) || '???';

    ctx.fillStyle = '#faa61a';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('👑 CHAMPION', rx, ry - 14);
    drawRoundedRect(ctx, rx, ry, SLOT_W + 20, SLOT_H, 6, '#3a2a00', '#faa61a');
    ctx.fillStyle = '#faa61a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🏆 ${champName}`, rx + 10, ry + SLOT_H / 2);

    // Connector from final match
    const lastX = getMatchX(rounds - 1) + SLOT_W;
    const lastY = PADDING + 30 + spacing / 2 - baseSpacing / 2 + SLOT_H + PAIR_GAP / 2;
    ctx.strokeStyle = '#faa61a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(rx, ry + SLOT_H / 2);
    ctx.stroke();
  }

  return canvas.toBuffer('image/png');
}

module.exports = { buildBracketImage };
