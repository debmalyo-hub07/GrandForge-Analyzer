// ECO E — Catalan, Indian defences with 3.Nf3/3.Nc3: Bogo-Indian, Queen's
// Indian, Nimzo-Indian, King's Indian.
// See ./index.ts for what this data is and how the join key works.
import type { OpeningTheory } from './index';

export const OPENING_THEORY_E: OpeningTheory[] = [
  {
    eco: 'E00',
    name: 'Catalan Opening',
    moves: 'd4 Nf6 c4 e6 g3',
    text: "White combines the Queen's Gambit pawn structure with a kingside fianchetto, putting the bishop on g2 where it presses down the long diagonal at d5, c6, and b7 for the rest of the game. It is one of the most respected and enduring systems against 1...e6 setups.\n\nBlack's two main approaches are the Open Catalan (d5 and dxc4, grabbing the pawn and trying to hold it with a6 and b5 or to give it back for development) and the Closed Catalan (d5 and c6 or Be7 with a solid, cramped structure). White's compensation for the pawn in the Open lines is permanent pressure — Qa4 or Qc2, Ne5, Rd1, and e4. Slow, deep, and famously hard to play against.",
  },
  {
    eco: 'E02',
    name: 'Catalan Opening: Open Defense',
    moves: 'd4 Nf6 c4 e6 g3 d5 Bg2 dxc4',
    text: "The Open Catalan — the most testing and most theoretically important treatment. Black has taken on c4, accepting a pawn in exchange for letting White's light-squared bishop breathe on the long diagonal.\n\nWhite typically plays Qa4+ or Qc2 and Nf3, recovering the pawn or getting enormous compensation for it: the g2 bishop, the open c- and d-files, and pressure Black must neutralise before developing the c8 bishop. Black's methods are a6 and b5 to hold the pawn, Bd7 and Bc6 to trade off the Catalan bishop, or c5 and Nc6 for immediate central counterplay. Knowing which one you are playing for matters more than knowing many moves.",
  },
  {
    eco: 'E06',
    name: 'Catalan Opening: Closed',
    moves: 'd4 Nf6 c4 e6 g3 d5 Bg2 Be7 Nf3',
    text: "Black declines to take on c4 and builds a solid, compact position instead: 0-0, c6 or Nbd7, b6 and Bb7 or dxc4 later. The structure is very hard to break, and it avoids all the Open Catalan's pawn-grabbing theory.\n\nWhite's plans are 0-0, Qc2 or Qd3, Nbd2 or Nc3, b3 and Bb2, Rd1, and then e4 for a central break or cxd5 to fix the structure. Black's freeing problem is the familiar Queen's-Gambit one: find the moment for c5 or dxc4 and e5, and solve the c8 bishop. It is a legitimate, well-tested choice, but Black must be comfortable defending a slightly cramped position for a long time.",
  },
  {
    eco: 'E10',
    name: 'Indian Defense: Anti-Nimzo-Indian',
    moves: 'd4 Nf6 c4 e6 Nf3',
    text: "White develops the knight to f3 rather than c3, sidestepping the Nimzo-Indian entirely — there is no knight on c3 for Black's bishop to pin. It is one of the most common move-order choices at every level.\n\nBlack's replies define the game: 3...b6 is the Queen's Indian, 3...Bb4+ the Bogo-Indian, 3...d5 heads for the Queen's Gambit Declined or Catalan, and 3...c5 for the Benoni or Blumenfeld. White's follow-ups are g3 for the Catalan or a Queen's Indian fianchetto, Nc3 once the pin is no longer available, or Bg5 and e3. Choosing this move order is a repertoire decision: you trade the Nimzo's theory for a different family of it.",
  },
  {
    eco: 'E10',
    name: 'Blumenfeld Countergambit',
    moves: 'd4 Nf6 c4 e6 Nf3 c5 d5 b5',
    text: "Black offers a pawn to build a big centre. After 5.dxe6 fxe6 6.cxb5 d5 Black has pawns on c5, d5, and e6 with the bishops ready to come to d6 and b7 — a genuine central mass in exchange for the material.\n\nWhite's soundest answer is 5.Bg5, pinning the knight and declining the gambit, which is considered the critical test. If White accepts, the resulting positions are unbalanced and rich: Black's centre is impressive but can become a target for e4 or Nc3 pressure. It is a fine practical weapon for players who want an unbalanced game from the opening, and a reminder that in the Indian defences the centre can be seized by the second player too.",
  },
  {
    eco: 'E10',
    name: 'Blumenfeld Countergambit Accepted',
    moves: 'd4 Nf6 c4 e6 Nf3 c5 d5 b5 dxe6 fxe6 cxb5 d5',
    text: "The full acceptance and the position the gambit is played for. Black has three connected central pawns on c5, d5, and e6, a half-open f-file, and rapid development with Bd6, 0-0, Bb7, and Nbd7; White has an extra pawn on b5 and a lot of defending to do.\n\nWhite's plan is to develop quickly with e3, Be2, 0-0, b3 and Bb2, and Nc3 or Nbd2, then challenge the centre with e4 or blockade on d4. Black's is to advance in the centre and attack down the f-file before White consolidates. The evaluation is close to balanced and the play is concrete — a genuinely interesting fight where the material and the structure point in opposite directions.",
  },
  {
    eco: 'E11',
    name: 'Bogo-Indian Defense',
    moves: 'd4 Nf6 c4 e6 Nf3 Bb4+',
    text: "Black gives a check to force White to spend a move on the bishop's fate, then usually trades it off or retreats it to e7, reaching a solid, low-theory position. It is the practical answer for players who want to meet 3.Nf3 without learning Queen's Indian theory.\n\nWhite's replies are 4.Bd2 (the main line, when Bxd2+ or Qe7 follows), 4.Nbd2 (the Grünfeld Variation, keeping pieces on), and 4.Nc3 transposing to the Nimzo. Black's subsequent plans are d5 or d6 with e5, b6 and Bb7, and 0-0. The Bogo-Indian is genuinely sound and genuinely modest: Black concedes a small edge but reaches a comfortable position with very little memorisation.",
  },
  {
    eco: 'E11',
    name: 'Bogo-Indian Defense: Grünfeld Variation',
    moves: 'd4 Nf6 c4 e6 Nf3 Bb4+ Nbd2',
    text: "White blocks the check with the knight rather than the bishop, keeping the dark-squared bishop free for f4 or g5 and inviting Black to make something of the pin. The cost is that the knight on d2 is passive and the c1 bishop's development still needs a move.\n\nBlack continues 0-0, d5 or b6 with Bb7, and c5 or d6 with e5 and Nc6, aiming to open the centre while the knight is on its poor square. White plays a3 to kick the bishop, e3, Bd3 or Be2, 0-0, and then b4 and Bb2 for queenside space. It is a sensible way to avoid the bishop trade, and the resulting positions reward whoever handles the c5 and e5 breaks better.",
  },
  {
    eco: 'E11',
    name: 'Bogo-Indian Defense: Exchange Variation',
    moves: 'd4 Nf6 c4 e6 Nf3 Bb4+ Bd2 Bxd2+',
    text: "Black takes immediately, trading a developed bishop for a developed bishop and simplifying toward a comfortable position. White recaptures with the queen (usually) or the knight, and the game becomes a quiet Queen's-Pawn manoeuvring battle.\n\nAfter 5.Qxd2 White plays g3 and Bg2 or Nc3 and e3, then 0-0, Rd1 or e4 with a small space edge. Black continues d6 or d5, 0-0, Nbd7 or Nc6, and Qe7 with e5, or b6 and Bb7. The strategic message of the whole line: trading pieces is a legitimate way to solve a cramped position, and Black's structure here has no weaknesses at all. Low-risk, low-reward, and perfectly respectable.",
  },
  {
    eco: 'E12',
    name: "Queen's Indian Defense",
    moves: 'd4 Nf6 c4 e6 Nf3 b6',
    text: "Black fianchettoes the light-squared bishop to control e4 from a distance — the hypermodern answer to the Queen's Gambit Declined's classic bad-bishop problem. Rather than fighting for the centre with pawns, Black watches it with pieces.\n\nWhite's main systems are 4.g3 (the Fianchetto Variation, the main line, meeting bishop with bishop on the long diagonal), 4.a3 (the Petrosian, taking b4 from Black before developing), and 4.Nc3 or 4.e3. Black plays Bb7 or Ba6, Be7 or Bb4, 0-0, and d5 or c5 at the right moment. It is one of the soundest and most flexible defences in chess, and a permanent fixture of elite repertoires.",
  },
  {
    eco: 'E12',
    name: "Queen's Indian Defense: Petrosian Variation",
    moves: 'd4 Nf6 c4 e6 Nf3 b6 a3',
    text: "Petrosian's prophylactic idea: spend a tempo on a3 so that Nc3 can be played without allowing Bb4, giving White the ideal setup of pawns on c4 and d4 with a knight on c3 and no pin to worry about.\n\nAfter 4...Bb7 5.Nc3 White plays d5 or Bg5 and e3, aiming to build the big centre with e4. Black's counters are d5 challenging immediately, Ba6 hitting c4, or c5 and g6 with Bg7 for a different structure. The whole variation is a lesson in prophylaxis: one modest pawn move removes Black's most active resource and changes the entire character of the opening. It remains a main line decades later.",
  },
  {
    eco: 'E12',
    name: "Queen's Indian Defense: Kasparov-Petrosian Variation",
    moves: 'd4 Nf6 c4 e6 Nf3 b6 a3 Bb7 Nc3',
    text: "The point of a3 realised: the knight comes to c3 unmolested, White's centre is ready to expand with d5 or e4, and Black must find counterplay before the space advantage becomes permanent. Kasparov's contributions made this one of the sharpest anti-Queen's-Indian weapons.\n\nBlack's main replies are 5...d5 challenging at once (when 6.cxd5 or 6.Bg5 leads to well-mapped play), 5...Ne4 offering a trade, and 5...g6 with Bg7. White continues d5 or Bg5, e3 or Qc2, Bd3 or Be2, and 0-0 with e4. Both sides need concrete knowledge here — the position looks quiet, but the central breaks come fast and they are all forcing.",
  },
  {
    eco: 'E14',
    name: "Queen's Indian Defense, with e3",
    moves: 'd4 Nf6 c4 e6 Nf3 d5 e3 b6 Nc3 Bb7',
    text: "A hybrid structure: Black has played both d5 and b6, combining the Queen's Gambit Declined's central pawn with the Queen's Indian's bishop. White has kept things modest with e3, planning Bd3 or Be2, 0-0, b3 and Bb2, and then cxd5 or e4 for a break.\n\nBlack's plans are Be7 or Bd6, 0-0, Nbd7 or c5, and dxc4 with c5 or Ne4. The structure is solid on both sides and the game is decided by who executes their central break under better circumstances — White's e4 or Black's c5. It is a good practical position for players who prefer manoeuvring to memorisation, and it arises from many different move orders.",
  },
  {
    eco: 'E14',
    name: "Queen's Indian Defense, with e3, Bb4+ Line",
    moves: 'd4 Nf6 c4 e6 Nf3 Bb4+ Nbd2 b6 e3 Bb7',
    text: "A Bogo-Indian and Queen's Indian hybrid: Black checks on b4, White blocks with the knight, and Black then fianchettoes anyway, ending up with both the active bishop and the long-diagonal pressure.\n\nWhite continues a3 to kick the bishop, Bd3 or Be2, 0-0, b3 and Bb2, and Qc2 with e4 for a central break. Black plays 0-0, d6 or d5, Nbd7 or c5, and Ne4 or Qe7 with e5. The key strategic question is whether White achieves e4: with both black bishops eyeing that square and the knight on d2 passive, it takes preparation. A quiet, flexible position where understanding the two central breaks is worth more than any variation.",
  },
  {
    eco: 'E15',
    name: "Queen's Indian Defense: Fianchetto Variation",
    moves: 'd4 Nf6 c4 e6 Nf3 b6 g3',
    text: "The main line of the Queen's Indian: White meets the fianchetto with a fianchetto, contesting the long diagonal directly with Bg2. The resulting battle for e4 and the light squares is the strategic heart of the whole opening.\n\nBlack's principal answers are 4...Ba6 (the modern main line, hitting c4 immediately and forcing White to respond with Qc2, b3, or Nbd2 before completing development) and 4...Bb7 (the classical, followed by Be7 and 0-0 with d5 or c5). White plays Bg2, 0-0, Nc3 or Nbd2, Qc2, Rd1, and e4 or d5. It is deeply analysed, structurally rich, and one of the most common openings at the top level.",
  },
  {
    eco: 'E17',
    name: "Queen's Indian Defense: Classical Variation",
    moves: 'd4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O',
    text: "The classical Queen's Indian picture: both sides have fianchettoed and castled, and the game becomes a slow strategic contest over e4 and d5. Black's setup is complete and sound; White's small pull comes from the extra central space.\n\nBlack's continuations are 0-0 with d5 (fixing the centre and heading for a symmetrical structure), Ne4 (offering trades to relieve the cramp), or c5 with Nc6 for immediate central pressure. White plays Nc3 or Nbd2, Qc2 or Re1, b3 and Bb2, and then d5 or e4. The recurring theme is that every trade helps Black and every advance helps White — which tells both sides exactly what to aim for.",
  },
  {
    eco: 'E20',
    name: 'Nimzo-Indian Defense',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4',
    text: "Nimzowitsch's masterpiece and one of the two or three best defences to 1.d4 ever devised. Black pins the c3 knight — the piece that supports e4 — and is usually willing to trade bishop for knight to give White doubled c-pawns, playing against the structure rather than for the bishop pair.\n\nWhite's main systems are 4.Qc2 (Classical, avoiding the doubled pawns), 4.e3 (Rubinstein, the most flexible), 4.a3 (Sämisch, forcing the trade at the cost of time), 4.f3, 4.Bg5 (Leningrad), and 4.g3. Black's plans revolve around c5, d5 or b6 with Ba6, and Ne4. Every serious 1.d4 player must have an answer to it, and the strategic themes it teaches are foundational.",
  },
  {
    eco: 'E24',
    name: 'Nimzo-Indian Defense: Sämisch Variation',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 a3',
    text: "White forces the issue immediately: the bishop must take on c3 or retreat. After 4...Bxc3+ 5.bxc3 White has doubled c-pawns and the bishop pair, plus a big centre with f3 and e4 to come — the sharpest and most committal way to meet the Nimzo.\n\nBlack's counterplay targets the structure: c5 and Nc6 with pressure on d4 and c4, b6 and Ba6 hitting the c4 pawn, and d6 with Ne8 or Na5. White plays f3 and e4, Bd3, Ne2, and 0-0 with a kingside attack. The whole variation is a clean strategic argument — bishops and centre versus structure and blockade — and it produces some of the most instructive middlegames in chess.",
  },
  {
    eco: 'E30',
    name: 'Nimzo-Indian Defense: Leningrad Variation',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 Bg5',
    text: "White develops the bishop with a pin of its own, meeting Black's pin with a counter-pin and preparing e3 or f3 with e4. It is a sharp, less-charted alternative to the main systems and it can lead to very unbalanced play.\n\nBlack's main replies are 4...h6 5.Bh4 c5, striking at the centre while White's bishop is committed, and 4...c5 immediately. White continues d5 or e3, f3 and e4, Qc2 or Rc1, and 0-0-0 in the sharpest lines. Because both sides have pinned pieces and both can break the pin at a cost, the tactics arrive early. A good practical weapon for White players who want an unusual Nimzo without giving up ambition.",
  },
  {
    eco: 'E32',
    name: 'Nimzo-Indian Defense: Classical Variation',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 Qc2',
    text: "The Classical (Capablanca) Variation: White defends the c3 knight with the queen so that Bxc3+ can be recaptured with the queen, avoiding the doubled pawns altogether. The cost is time and an early queen commitment, which Black tries to exploit.\n\nBlack's main answers are 4...0-0 5.a3 Bxc3+ 6.Qxc3 (when b6 and Bb7 or d5 and Ne4 follow), 4...d5, and 4...c5. White gets the bishop pair and a clean structure, and plays for e4 and a space advantage with Bg5 or Nf3, e3, Bd3, and 0-0. It is the most popular anti-Nimzo system at the top level precisely because White keeps the structural trump without conceding much.",
  },
  {
    eco: 'E40',
    name: 'Nimzo-Indian Defense: Rubinstein System',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3',
    text: "The most flexible answer to the Nimzo. White develops modestly and keeps every plan available: Bd3 and Nf3 or Ne2, 0-0, a3 at the right moment, and then f3 and e4 or d5 and cxd5 depending on what Black chooses.\n\nBlack's main systems are the Hübner (c5 and Nc6 with d6, closing the centre and playing against the doubled pawns), the Rubinstein main lines with 0-0 and d5 or b6, and the Fischer Variation with b6 and Ba6. Because White has committed to almost nothing, the game is decided by understanding rather than by memorised lines — which makes this the practical choice for players who want a fight without a theoretical duel.",
  },
  {
    eco: 'E46',
    name: 'Nimzo-Indian Defense: Normal Variation',
    moves: 'd4 Nf6 c4 e6 Nc3 Bb4 e3 O-O',
    text: "Black castles and waits, keeping the bishop on b4 and every plan available. White's fifth move now chooses the direction: 5.Nf3 (transposing to main lines with d5 or c5), 5.Bd3 (the classical build), 5.Ne2 (the Reshevsky, avoiding the doubled pawns since Nxc3 can be met by Nxc3), and 5.a3.\n\nBlack's follow-ups are d5 (a Queen's-Gambit-flavoured structure with the extra bishop pin), c5 (hitting d4 and heading for Hübner or Karpov structures), and b6 with Ba6 or Bb7. The important habit to build here: watch the c4 pawn and the e4 square. Almost every Nimzo plan on both sides is really about one of those two.",
  },
  {
    eco: 'E60',
    name: "Queen's Pawn, Mengarini Attack",
    moves: 'd4 Nf6 c4 g6 Qc2',
    text: "An offbeat third move: the queen goes to c2 early to support e4 and keep the b1 knight's options open, aiming to build the big centre without allowing the pins that Nc3 invites.\n\nBlack should respond in normal King's-Indian or Grünfeld fashion: Bg7, 0-0, and then d5 (hitting the centre while the queen is committed) or d6 with e5. The queen on c2 is a slightly awkward target for Nc6 or Bf5 ideas, and it does not help against Black's central breaks. Treat it as a playable but unambitious sideline: develop normally, strike in the centre, and let the early queen move justify itself or not.",
  },
  {
    eco: 'E60',
    name: "King's Indian Defense: Fianchetto Variation",
    moves: 'd4 Nf6 c4 g6 Nf3 Bg7 g3',
    text: "White meets the King's Indian with a fianchetto of its own, producing the most positionally sound anti-KID system. The bishop on g2 defends the king, supports the centre, and takes much of the sting out of Black's traditional kingside attack.\n\nWhite continues Bg2, 0-0, Nc3, d5 or e4, and then b4 and c5 or Rb1 with queenside expansion. Black plays 0-0, d6, Nbd7 or Nc6, and e5 or c5, with the standard KID plans of Ne8 or Nh5 and f5. Because White's king is safer than in the classical lines, Black often prefers central and queenside play here instead of the all-out attack. Solid, subtle, and a genuine test of KID understanding.",
  },
  {
    eco: 'E61',
    name: "King's Indian Defense",
    moves: 'd4 Nf6 c4 g6 Nc3',
    text: "The King's Indian: Black concedes the centre, fianchettoes, castles, and then attacks it — usually with e5 and a kingside pawn storm while White expands on the queenside. It produces some of the most violent and most instructive middlegames in chess.\n\nWhite's main systems are the Classical or Orthodox (e4, Nf3, Be2), the Sämisch (f3), the Four Pawns Attack (f4), the Averbakh (Be2 and Bg5), the Petrosian (d5), and the Fianchetto (g3). Black's standard scheme is Bg7, 0-0, d6, e5 or c5, and then Ne8 or Nd7 with f5 and a kingside avalanche. It is a fighting opening in the truest sense: both sides attack, and whoever is faster wins.",
  },
  {
    eco: 'E70',
    name: "King's Indian Defense: Normal Variation",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4',
    text: "White builds the full classical centre with pawns on c4, d4, and e4 — exactly what the King's Indian invites — and now the character of the game depends on White's next move: Nf3 for the Classical, f3 for the Sämisch, f4 for the Four Pawns, Be2 and Bg5 for the Averbakh, or Bd3 and Nge2.\n\nBlack continues d6 and 0-0, then e5 or c5 to challenge the centre. The strategic bargain of the whole opening is now visible: White has more space everywhere, and Black has a completely healthy structure with a plan to attack the king. Once White plays d5 and locks the centre, the race begins — White on the queenside, Black on the kingside.",
  },
  {
    eco: 'E73',
    name: "King's Indian Defense: Averbakh Variation",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Be2 O-O Bg5',
    text: "The Averbakh: White develops the bishop to g5 before committing the g1 knight, specifically to discourage Black's standard e5 break — because e5 would allow dxe5 with pressure on the pinned position and awkward tactics around d8 and h4.\n\nBlack's main answers are 6...c5 (heading for Benoni structures after d5, which is the most common solution), 6...h6 kicking the bishop, 6...Na6 or 6...Nbd7 preparing e5 anyway, and 6...c6 with Qa5. White continues Qd2, Nf3 or f4, 0-0 or 0-0-0, and queenside expansion. It is a good practical system precisely because it takes Black's most natural plan away and forces a different kind of game.",
  },
  {
    eco: 'E76',
    name: "King's Indian Defense: Four Pawns Attack",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4',
    text: "The most direct anti-KID system: White takes the entire centre with four pawns and plans to steamroll forward with e5 or f5. It is genuinely dangerous and genuinely overextended — both descriptions are accurate, which is what makes it fun.\n\nBlack's classical antidote is c5, striking at the base immediately: 6...c5 7.d5 e6 opens lines against the centre before White can consolidate. Black can also play 6...0-0 7.Nf3 c5 or 6...Na6 and e5. White's plan is Nf3, Be2, 0-0, and e5 or f5. The strategic rule for Black is simple and absolute: a big pawn centre must be attacked at once, because if White is allowed to develop and push, the attack is unstoppable.",
  },
  {
    eco: 'E80',
    name: "King's Indian Defense: Sämisch Variation",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3',
    text: "The Sämisch: White supports e4 with the f-pawn, giving up the natural knight square but building an unshakeable centre and preparing Be3, Qd2, 0-0-0, and a kingside pawn storm with g4 and h4 — turning the King's Indian's own weapon around.\n\nBlack's main answers are 6...0-0 7.Be3 c5 (the Benoni-style break, sharp and critical), 6...e5 (the classical, when d5 leads to a locked centre and mutual pawn storms), 6...Nc6 with a6 and Rb8, and 6...c6 with a6 and b5. It is one of the most testing anti-KID systems and one of the sharpest: with kings on opposite wings and closed centres, the game becomes a pure race.",
  },
  {
    eco: 'E91',
    name: "King's Indian Defense: Orthodox Variation",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2',
    text: "The Classical or Orthodox King's Indian, the main line and the position that defines the opening. White develops naturally and will castle, then meet Black's e5 with d5 (closing the centre), dxe5, or Be3 with maintaining tension.\n\nAfter 6...e5 7.0-0 Nc6 8.d5 Ne7 the classic race begins: White plays c5, b4, Rc1, and a4-a5 on the queenside while Black plays Ne8 or Nd7, f5, g5, Ng6 and Rf6-h6 on the kingside. Both attacks are real and both are fast. This structure has produced more brilliant attacking games than almost any other, and understanding the tempo count on both wings is the whole skill.",
  },
  {
    eco: 'E92',
    name: "King's Indian Defense: Petrosian Variation",
    moves: 'd4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 d5',
    text: "Petrosian's move: White closes the centre immediately with d5 rather than allowing Black to choose the moment, gaining space and defining the structure on White's own terms. It is prophylaxis in the classic Petrosian style.\n\nAfter 7...a5 or 7...Nbd7 or 7...Na6, White plays Bg5 or Be3, Nd2 or Ne1, and then c5 and b4 with queenside expansion; Black plays Ne8 or Nh5, f5, and the kingside storm, or Nc5 and a4 to slow White down. The strategic contest is the King's Indian's eternal one — opposite-wing attacks in a locked centre — but with White having gained a tempo and taken away Black's choice about when the centre closes.",
  },
];
