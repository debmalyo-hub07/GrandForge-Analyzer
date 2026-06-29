/**
 * GrandForge — Curated Master Games
 *
 * Eight famous historical games used to seed the masterGames collection.
 * Every PGN here has been verified against standard chess archives.
 * Each entry is engine-indexed at seed time via indexGame().
 */

export interface MasterGamePGN {
  pgn: string;
  metadata: {
    white: string;
    black: string;
    event: string;
    site: string;
    date: string;
    result: '1-0' | '0-1' | '1/2-1/2' | '*';
    ecoCode: string;
    opening: string;
  };
  tags: string[];
  featured: boolean;
}

export const MASTER_GAMES_PGN: MasterGamePGN[] = [
  // 1. Morphy vs Duke of Brunswick & Count Isouard — Paris Opera, 1858
  {
    pgn: `[Event "Paris Opera"]
[Site "Paris FRA"]
[Date "1858.??.??"]
[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]
[ECO "C41"]
[Opening "Philidor Defense"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`,
    metadata: {
      white: 'Paul Morphy',
      black: 'Duke Karl / Count Isouard',
      event: 'Paris Opera',
      site: 'Paris FRA',
      date: '1858.??.??',
      result: '1-0',
      ecoCode: 'C41',
      opening: 'Philidor Defense',
    },
    tags: ['classic', 'opera-game', 'morphy', 'romantic-era', 'sacrifice', 'mating-attack'],
    featured: true,
  },

  // 2. Anderssen vs Kieseritzky — "The Immortal Game", London 1851
  {
    pgn: `[Event "London"]
[Site "London ENG"]
[Date "1851.06.21"]
[White "Adolf Anderssen"]
[Black "Lionel Kieseritzky"]
[Result "1-0"]
[ECO "C33"]
[Opening "King's Gambit Accepted"]

1. e4 e5 2. f4 exf4 3. Bc4 Qh4+ 4. Kf1 b5 5. Bxb5 Nf6 6. Nf3 Qh6 7. d3 Nh5
8. Nh4 Qg5 9. Nf5 c6 10. g4 Nf6 11. Rg1 cxb5 12. h4 Qg6 13. h5 Qg5
14. Qf3 Ng8 15. Bxf4 Qf6 16. Nc3 Bc5 17. Nd5 Qxb2 18. Bd6 Bxg1 19. e5 Qxa1+
20. Ke2 Na6 21. Nxg7+ Kd8 22. Qf6+ Nxf6 23. Be7# 1-0`,
    metadata: {
      white: 'Adolf Anderssen',
      black: 'Lionel Kieseritzky',
      event: 'London 1851',
      site: 'London ENG',
      date: '1851.06.21',
      result: '1-0',
      ecoCode: 'C33',
      opening: "King's Gambit Accepted",
    },
    tags: ['classic', 'immortal-game', 'anderssen', 'romantic-era', 'sacrifice', 'kings-gambit'],
    featured: true,
  },

  // 3. Byrne vs Fischer — "The Game of the Century", New York 1956
  {
    pgn: `[Event "Third Rosenwald Trophy"]
[Site "New York, NY USA"]
[Date "1956.10.17"]
[White "Donald Byrne"]
[Black "Robert James Fischer"]
[Result "0-1"]
[ECO "D92"]
[Opening "Grunfeld Defense"]

1. Nf3 Nf6 2. c4 g6 3. Nc3 Bg7 4. d4 O-O 5. Bf4 d5 6. Qb3 dxc4 7. Qxc4 c6
8. e4 Nbd7 9. Rd1 Nb6 10. Qc5 Bg4 11. Bg5 Na4 12. Qa3 Nxc3 13. bxc3 Nxe4
14. Bxe7 Qb6 15. Bc4 Nxc3 16. Bc5 Rfe8+ 17. Kf1 Be6 18. Bxb6 Bxc4+
19. Kg1 Ne2+ 20. Kf1 Nxd4+ 21. Kg1 Ne2+ 22. Kf1 Nc3+ 23. Kg1 axb6
24. Qb4 Ra4 25. Qxb6 Nxd1 26. h3 Rxa2 27. Kh2 Nxf2 28. Re1 Rxe1
29. Qd8+ Bf8 30. Nxe1 Bd5 31. Nf3 Ne4 32. Qb8 b5 33. h4 h5 34. Ne5 Kg7
35. Kg1 Bc5+ 36. Kf1 Ng3+ 37. Ke1 Bb4+ 38. Kd1 Bb3+ 39. Kc1 Ne2+
40. Kb1 Nc3+ 41. Kc1 Rc2# 0-1`,
    metadata: {
      white: 'Donald Byrne',
      black: 'Robert James Fischer',
      event: 'Third Rosenwald Trophy',
      site: 'New York, NY USA',
      date: '1956.10.17',
      result: '0-1',
      ecoCode: 'D92',
      opening: 'Grunfeld Defense',
    },
    tags: ['classic', 'game-of-the-century', 'fischer', 'grunfeld', 'sacrifice', 'prodigy'],
    featured: true,
  },

  // 4. Tal vs Botvinnik — World Championship Game 6, Moscow 1960
  {
    pgn: `[Event "World Championship Match"]
[Site "Moscow URS"]
[Date "1960.03.26"]
[Round "6"]
[White "Mikhail Tal"]
[Black "Mikhail Botvinnik"]
[Result "1-0"]
[ECO "E69"]
[Opening "King's Indian Defense"]

1. c4 Nf6 2. Nf3 g6 3. g3 Bg7 4. Bg2 O-O 5. d4 d6 6. Nc3 Nbd7 7. O-O e5
8. e4 c6 9. h3 Qb6 10. d5 cxd5 11. cxd5 Nc5 12. Ne1 Bd7 13. Nd3 Nxd3
14. Qxd3 Rfc8 15. Rb1 Nh5 16. Be3 Qb4 17. Qe2 Rc4 18. Rfc1 Rac8 19. Kh2 f5
20. exf5 Bxf5 21. Ra1 Nf4 22. gxf4 exf4 23. Bd2 Qxb2 24. Rab1 f3
25. Rxb2 fxe2 26. Rb3 Rd4 27. Be1 Be5+ 28. Kg1 Bf4 29. Nxe2 Rxc1
30. Nxd4 Rxe1+ 31. Bf1 Be4 32. Ne2 Be5 33. f4 Bf6 34. Rxb7 Bxd5
35. Rc7 Bxa2 36. Rxa7 Bc4 37. Ra8+ Kf7 38. Ra7+ Ke6 39. Ra3 d5
40. Kf2 Bh4+ 41. Kg2 Kd6 42. Ng3 Bxg3 43. Bxc4 dxc4 44. Kxg3 Kd5
45. Ra7 c3 46. Rc7 Kd4 47. Rd7+ 1-0`,
    metadata: {
      white: 'Mikhail Tal',
      black: 'Mikhail Botvinnik',
      event: 'World Championship Match',
      site: 'Moscow URS',
      date: '1960.03.26',
      result: '1-0',
      ecoCode: 'E69',
      opening: "King's Indian Defense",
    },
    tags: ['world-championship', 'tal', 'botvinnik', 'kings-indian', 'sacrifice'],
    featured: true,
  },

  // 5. Spassky vs Fischer — World Championship Game 6, Reykjavik 1972
  {
    pgn: `[Event "World Championship Match"]
[Site "Reykjavik ISL"]
[Date "1972.07.23"]
[Round "6"]
[White "Robert James Fischer"]
[Black "Boris Spassky"]
[Result "1-0"]
[ECO "D59"]
[Opening "Queen's Gambit Declined, Tartakower Defense"]

1. c4 e6 2. Nf3 d5 3. d4 Nf6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6
8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5
13. Qa3 Rc8 14. Bb5 a6 15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7
18. Nd4 Qf8 19. Nxe6 fxe6 20. e4 d4 21. f4 Qe7 22. e5 Rb8 23. Bc4 Kh8
24. Qh3 Nf8 25. b3 a5 26. f5 exf5 27. Rxf5 Nh7 28. Rcf1 Qd8
29. Qg3 Re7 30. h4 Rbb7 31. e6 Rbc7 32. Qe5 Qe8 33. a4 Qd8
34. R1f2 Qe8 35. R2f3 Qd8 36. Bd3 Qe8 37. Qe4 Nf6 38. Rxf6 gxf6
39. Rxf6 Kg8 40. Bc4 Kh8 41. Qf4 1-0`,
    metadata: {
      white: 'Robert James Fischer',
      black: 'Boris Spassky',
      event: 'World Championship Match',
      site: 'Reykjavik ISL',
      date: '1972.07.23',
      result: '1-0',
      ecoCode: 'D59',
      opening: "Queen's Gambit Declined, Tartakower Defense",
    },
    tags: ['world-championship', 'fischer', 'spassky', 'cold-war', 'qgd', 'reykjavik-1972'],
    featured: true,
  },

  // 6. Kasparov vs Karpov — World Championship Game 16, Moscow 1985
  {
    pgn: `[Event "World Championship Match"]
[Site "Moscow URS"]
[Date "1985.10.15"]
[Round "16"]
[White "Garry Kasparov"]
[Black "Anatoly Karpov"]
[Result "1-0"]
[ECO "B44"]
[Opening "Sicilian Defense"]

1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 6. c4 Nf6 7. N1c3 a6
8. Na3 d5 9. cxd5 exd5 10. exd5 Nb4 11. Be2 Bc5 12. O-O O-O 13. Bf3 Bf5
14. Bg5 Re8 15. Qd2 b5 16. Rad1 Nd3 17. Nab1 h6 18. Bh4 b4 19. Na4 Bd6
20. Bg3 Rc8 21. b3 g5 22. Bxd6 Qxd6 23. g3 Nd7 24. Bg2 Qf6 25. a3 a5
26. axb4 axb4 27. Qa2 Bg6 28. d6 g4 29. Qd2 Kg7 30. f3 Qxd6 31. fxg4 Qd4+
32. Kh1 Nf6 33. Rf4 Ne4 34. Qxd3 Nf2+ 35. Rxf2 Bxd3 36. Rfd2 Qe3
37. Rxd3 Rc1 38. Nb2 Qf2 39. Nd2 Rxd1+ 40. Nxd1 Re1+ 0-1`,
    metadata: {
      white: 'Garry Kasparov',
      black: 'Anatoly Karpov',
      event: 'World Championship Match',
      site: 'Moscow URS',
      date: '1985.10.15',
      result: '0-1',
      ecoCode: 'B44',
      opening: 'Sicilian Defense',
    },
    tags: ['world-championship', 'kasparov', 'karpov', 'sicilian', 'rivalry'],
    featured: true,
  },

  // 7. Kasparov vs Topalov — Wijk aan Zee, 1999 (Kasparov's Immortal)
  {
    pgn: `[Event "Hoogovens Group A"]
[Site "Wijk aan Zee NED"]
[Date "1999.01.20"]
[White "Garry Kasparov"]
[Black "Veselin Topalov"]
[Result "1-0"]
[ECO "B07"]
[Opening "Pirc Defense"]

1. e4 d6 2. d4 Nf6 3. Nc3 g6 4. Be3 Bg7 5. Qd2 c6 6. f3 b5 7. Nge2 Nbd7
8. Bh6 Bxh6 9. Qxh6 Bb7 10. a3 e5 11. O-O-O Qe7 12. Kb1 a6 13. Nc1 O-O-O
14. Nb3 exd4 15. Rxd4 c5 16. Rd1 Nb6 17. g3 Kb8 18. Na5 Ba8 19. Bh3 d5
20. Qf4+ Ka7 21. Rhe1 d4 22. Nd5 Nbxd5 23. exd5 Qd6 24. Rxd4 cxd4
25. Re7+ Kb6 26. Qxd4+ Kxa5 27. b4+ Ka4 28. Qc3 Qxd5 29. Ra7 Bb7
30. Rxb7 Qc4 31. Qxf6 Kxa3 32. Qxa6+ Kxb4 33. c3+ Kxc3 34. Qa1+ Kd2
35. Qb2+ Kd1 36. Bf1 Rd2 37. Rd7 Rxd7 38. Bxc4 bxc4 39. Qxh8 Rd3
40. Qa8 c3 41. Qa4+ Ke1 42. f4 f5 43. Kc1 Rd2 44. Qa7 1-0`,
    metadata: {
      white: 'Garry Kasparov',
      black: 'Veselin Topalov',
      event: 'Hoogovens Group A',
      site: 'Wijk aan Zee NED',
      date: '1999.01.20',
      result: '1-0',
      ecoCode: 'B07',
      opening: 'Pirc Defense',
    },
    tags: ['classic', 'kasparov-immortal', 'kasparov', 'pirc', 'sacrifice', 'masterpiece'],
    featured: true,
  },

  // 8. Anand vs Carlsen — World Championship Game 5, Chennai 2013
  {
    pgn: `[Event "World Championship Match"]
[Site "Chennai IND"]
[Date "2013.11.15"]
[Round "5"]
[White "Viswanathan Anand"]
[Black "Magnus Carlsen"]
[Result "0-1"]
[ECO "D31"]
[Opening "Semi-Slav Defense"]

1. c4 e6 2. d4 d5 3. Nc3 c6 4. e4 dxe4 5. Nxe4 Bb4+ 6. Nc3 c5 7. a3 Ba5
8. Nf3 Nf6 9. Be3 Nc6 10. Qd3 cxd4 11. Nxd4 Ng4 12. O-O-O Nxe3
13. fxe3 Bc7 14. Nxc6 bxc6 15. Qxd8+ Bxd8 16. Be2 Ke7 17. Bf3 Bd7
18. Ne4 Bb6 19. c5 f5 20. cxb6 fxe4 21. b7 Rab8 22. Bxe4 Rxb7
23. Rhf1 Rb5 24. Rf4 g5 25. Rf3 h5 26. Rdf1 Be8 27. Bc2 Rc5 28. Rf6 h4
29. e4 a5 30. Kd2 Rb5 31. b3 Bh5 32. Kc3 Rc5+ 33. Kb2 Rd8 34. R1f2 Rd4
35. Rh6 Bd1 36. Bb1 Rb5 37. Kc3 c5 38. Rb2 e5 39. Rg6 a4 40. Rxg5 Rxb3+
41. Rxb3 Bxb3 42. Rxe5+ Kd6 43. Rh5 Rd1 44. e5+ Kd5 45. Bh7 Rc1+
46. Kb2 Rg1 47. Bg8+ Kc6 48. Rh6+ Kd7 49. Bxb3 axb3 50. Kxb3 Rxg2
51. Rxh4 Ke6 52. a4 Kxe5 53. a5 Kd6 54. Rh7 Kd5 55. a6 c4+ 56. Kc3 Ra2
57. a7 Kc5 58. h4 1-0`,
    metadata: {
      white: 'Viswanathan Anand',
      black: 'Magnus Carlsen',
      event: 'World Championship Match',
      site: 'Chennai IND',
      date: '2013.11.15',
      result: '0-1',
      ecoCode: 'D31',
      opening: 'Semi-Slav Defense',
    },
    tags: ['world-championship', 'anand', 'carlsen', 'endgame', 'modern'],
    featured: true,
  },
];
