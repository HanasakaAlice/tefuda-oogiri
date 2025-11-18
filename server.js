// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static('public'));

// ----------------- ゲーム設定 -----------------
const MAX_PLAYERS = 4;
const TOTAL_ROUNDS = 5;
const HAND_SIZE = 5;

// お題（後から増やしてOK）
const PROMPTS = [
  'こんな○○は嫌だ、どんな○○？',
  'ドラえもんの新しいひみつ道具とは？',
  '学校に一つだけゾンビがいる。その特徴とは？',
  'AIが暴走して最初にしたことは？',
  'タイムマシンで10年後に行ったら、日本はどうなっていた？',
  '世界一どうでもいいニュースを教えてください。',
  'ポケモンの新タイプ、その名も「○○タイプ」。どんなタイプ？',
  '新しい元号「○○」。どんな意味？',
  'サンタさんがクビになった理由とは？',
  'コンビニの新サービスがやばすぎる。その内容は？',
  '人類がついにやめた習慣とは？',
  '地球から「○○」が消えた。そのとき何が起きた？',
  'スマホに新しいボタンが追加。その効果とは？',
  '一生無料になるなら何を選ぶ？ ただし条件が一つある。それは？',
  '異世界転生したら、なぜか○○だった。○○とは？',
  '駅のアナウンスが突然「○○」になった。何と言った？',
  '現代日本に突然「勇者」が現れた。まず何をした？',
  '天才小学生が考えた、新しい科目の名前と内容とは？',
  '神様がTwitterを始めた。最初の一言は？',
  '卒業式で校長先生が言ってはいけない一言とは？'
];

// 手札に使う回答カード（後から増やしてOK）
const ANSWER_CARDS = [
  '課金すれば解決する',
  '全部AIのせいにする',
  'とりあえず土下座する',
  'Wi-Fiの電源を入れ直す',
  'それ、昨日も聞いた',
  'リモコンの電池をぐりぐりする',
  '一旦寝て忘れる',
  'それは夢だったことにする',
  '隣の席の人に丸投げする',
  '「仕様です」で押し通す',
  '急に関西弁になる',
  'とんでもない既読スルー',
  'なぜか上から目線',
  '全部伏せ字で投稿する',
  'ポイントカードを要求する',
  '「それってあなたの感想ですよね？」と言う',
  'すべてをメモ帳に書いてから消す',
  'カメラ目線でウインクする',
  '5年後に謝る',
  '謎のスタンプだけ送る',
  'すべてをママに相談する',
  '急にラップで話し出す',
  'ハイタッチでごまかす',
  '謎の英語を挟み込む',
  '全部SNSに投げる',
  'スマホを裏返して考える',
  'リモートでドヤ顔する',
  'とりあえずスクショを撮る',
  '「それもまた一興」と言う',
  '既読をつけないまま3日放置する',
  '全部占いで決める',
  'なぜかカレーになる',
  '空気を読まず拍手する',
  'ここだけ昭和になる',
  '急に早口になる',
  'とりあえず謝り倒す',
  '全部初期化する',
  '「バグです」で片付ける',
  'とんでもない長文を送りつける',
  '謎のスタンプ連打',
  'いきなり歌い出す',
  'すべてをノリで解決する',
  '「知らんけど」を付け足す',
  'すべてをジャンケンで決める',
  '何もしてないのに壊れる',
  'クソデカため息をつく',
  'とりあえずラーメンを食べる',
  '無言のいいねだけ押す',
  'すべてを黒歴史フォルダに入れる',
  '「続きはWebで」と言う'
];

// ----------------- ゲーム状態管理 -----------------
let players = []; // { id, name, socketId, hand:[], score }
let nextPlayerId = 1;

let gameState = {
  phase: 'waiting', // 'waiting' | 'play' | 'vote' | 'result' | 'finished'
  round: 0,
  currentPrompt: null,
  promptDeck: [],
  answerDeck: [],
  submissions: [], // { submissionId, playerId, text, votes }
  nextSubmissionId: 1,
  votesReceived: {} // voterPlayerId -> submissionId
};

// ----------------- ユーティリティ -----------------
function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function getHostPlayer() {
  if (players.length === 0) return null;
  return players[0]; // 一番最初に入った人をホスト扱い
}

function getPlayerBySocket(socket) {
  return players.find(p => p.socketId === socket.id) || null;
}

function getPlayerById(id) {
  return players.find(p => p.id === id) || null;
}

function broadcastLobby() {
  const host = getHostPlayer();
  io.emit('lobbyUpdate', {
    players: players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    })),
    maxPlayers: MAX_PLAYERS,
    hostId: host ? host.id : null,
    gamePhase: gameState.phase
  });
}

function dealInitialHands() {
  players.forEach(p => {
    p.hand = [];
    for (let i = 0; i < HAND_SIZE; i++) {
      const card = gameState.answerDeck.pop();
      if (card) p.hand.push(card);
    }
  });
}

// ----------------- ゲーム進行ロジック -----------------
function startGame() {
  if (players.length === 0) return;

  console.log('Game started');
  // 山札を初期化
  gameState.promptDeck = [...PROMPTS];
  gameState.answerDeck = [...ANSWER_CARDS];
  shuffle(gameState.promptDeck);
  shuffle(gameState.answerDeck);

  players.forEach(p => {
    p.score = 0;
  });

  gameState.round = 0;
  gameState.phase = 'play';
  gameState.submissions = [];
  gameState.votesReceived = {};
  gameState.nextSubmissionId = 1;

  dealInitialHands();
  startNextRound();
}

function startNextRound() {
  gameState.round += 1;

  if (gameState.round > TOTAL_ROUNDS) {
    endGame();
    return;
  }

  gameState.phase = 'play';
  gameState.submissions = [];
  gameState.votesReceived = {};

  // お題を1つ引く（足りなくなったらまたシャッフルして使い回し）
  if (gameState.promptDeck.length === 0) {
    gameState.promptDeck = [...PROMPTS];
    shuffle(gameState.promptDeck);
  }
  gameState.currentPrompt = gameState.promptDeck.pop();

  console.log(`Round ${gameState.round} started with prompt: ${gameState.currentPrompt}`);

  // 各プレイヤーにラウンド開始を通知（手札も送る）
  players.forEach(p => {
    const socket = io.sockets.sockets.get(p.socketId);
    if (socket) {
      socket.emit('roundStarted', {
        round: gameState.round,
        totalRounds: TOTAL_ROUNDS,
        prompt: gameState.currentPrompt,
        hand: p.hand,
        scores: players.map(pp => ({
          id: pp.id,
          name: pp.name,
          score: pp.score
        }))
      });
    }
  });

  broadcastLobby();
}
function tryMoveToVotePhase() {
  if (gameState.submissions.length === players.length) {
    gameState.phase = 'vote';

    // 提出カードを一度シャッフル（全員同じ順で見る）
    const shuffled = [...gameState.submissions];
    shuffle(shuffled);

    // 各プレイヤーごとに「これは自分のカードかどうか」を付けて送る
    players.forEach(p => {
      const socket = io.sockets.sockets.get(p.socketId);
      if (!socket) return;

      const submissionsForThisPlayer = shuffled.map(s => ({
        submissionId: s.submissionId,
        text: s.text,
        isMine: s.playerId === p.id   // 自分の出したカードなら true
      }));

      socket.emit('startVote', {
        round: gameState.round,
        totalRounds: TOTAL_ROUNDS,
        prompt: gameState.currentPrompt,
        submissions: submissionsForThisPlayer,
        scores: players.map(pp => ({
          id: pp.id,
          name: pp.name,
          score: pp.score
        }))
      });
    });
  }
}


function tryFinishVoting() {
  if (Object.keys(gameState.votesReceived).length === players.length) {
    // 集計
    gameState.phase = 'result';

    // submissionId -> submission オブジェクト
    const submissionMap = {};
    gameState.submissions.forEach(s => {
      submissionMap[s.submissionId] = s;
      s.votes = 0;
    });

    // 投票数カウント
    for (const [voterIdStr, submissionId] of Object.entries(gameState.votesReceived)) {
      const sub = submissionMap[submissionId];
      if (sub) {
        sub.votes += 1;
      }
    }

    // 点数加算
    gameState.submissions.forEach(s => {
      const owner = getPlayerById(s.playerId);
      if (owner) {
        owner.score += s.votes;
      }
    });

    // クライアント向けに結果を整形
    const resultsForClients = gameState.submissions.map(s => {
      const owner = getPlayerById(s.playerId);
      return {
        text: s.text,
        ownerName: owner ? owner.name : '？？？',
        votes: s.votes
      };
    });

    const scoresForClients = players.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    }));

    io.emit('roundResult', {
      round: gameState.round,
      prompt: gameState.currentPrompt,
      results: resultsForClients,
      scores: scoresForClients,
      isLastRound: gameState.round >= TOTAL_ROUNDS
    });

    // 少し待ってから次ラウンド（必要ならここはホストのボタンに変えてもいい）
    setTimeout(() => {
      startNextRound();
    }, 8000); // 8秒後に次ラウンド
  }
}

function endGame() {
  gameState.phase = 'finished';

  const ranking = [...players].sort((a, b) => b.score - a.score);

  io.emit('gameOver', {
    scores: ranking.map(p => ({
      id: p.id,
      name: p.name,
      score: p.score
    }))
  });

  broadcastLobby();
}

// ----------------- Socket.io イベント -----------------
io.on('connection', socket => {
  console.log('a user connected', socket.id);

  socket.on('joinGame', ({ name }) => {
    if (gameState.phase !== 'waiting') {
      socket.emit('errorMessage', { message: 'ゲーム進行中のため参加できません。' });
      return;
    }
    if (players.length >= MAX_PLAYERS) {
      socket.emit('errorMessage', { message: '満員です。' });
      return;
    }

    const player = {
      id: nextPlayerId++,
      name: name || `プレイヤー${nextPlayerId}`,
      socketId: socket.id,
      hand: [],
      score: 0
    };
    players.push(player);

    console.log(`Player joined: ${player.name} (${player.id})`);

    socket.emit('joined', {
      playerId: player.id
    });

    broadcastLobby();
  });

  socket.on('startGame', () => {
    const host = getHostPlayer();
    const player = getPlayerBySocket(socket);
    if (!player || !host || player.id !== host.id) {
      socket.emit('errorMessage', { message: 'ホストのみゲームを開始できます。' });
      return;
    }
    if (players.length < 2) {
      socket.emit('errorMessage', { message: '最低2人から開始できます。' });
      return;
    }
    if (gameState.phase !== 'waiting') return;
    startGame();
  });

  socket.on('playCard', ({ cardIndex }) => {
    const player = getPlayerBySocket(socket);
    if (!player) return;
    if (gameState.phase !== 'play') return;

    if (
      typeof cardIndex !== 'number' ||
      cardIndex < 0 ||
      cardIndex >= player.hand.length
    ) {
      socket.emit('errorMessage', { message: 'そのカードは選べません。' });
      return;
    }

    // すでに提出済みかチェック
    const alreadySubmitted = gameState.submissions.some(s => s.playerId === player.id);
    if (alreadySubmitted) {
      socket.emit('errorMessage', { message: 'このラウンドではすでにカードを出しています。' });
      return;
    }

    const [cardText] = player.hand.splice(cardIndex, 1);
    const submission = {
      submissionId: gameState.nextSubmissionId++,
      playerId: player.id,
      text: cardText,
      votes: 0
    };
    gameState.submissions.push(submission);

    socket.emit('cardPlayed', { ok: true });

    console.log(`Player ${player.name} played card: ${cardText}`);

    tryMoveToVotePhase();
  });

  socket.on('castVote', ({ submissionId }) => {
    const voter = getPlayerBySocket(socket);
    if (!voter) return;
    if (gameState.phase !== 'vote') return;

    // すでに投票していないか
    if (gameState.votesReceived[voter.id]) {
      socket.emit('errorMessage', { message: 'すでに投票済みです。' });
      return;
    }

    const submission = gameState.submissions.find(s => s.submissionId === submissionId);
    if (!submission) {
      socket.emit('errorMessage', { message: 'その回答は存在しません。' });
      return;
    }

    // 自分のカードには投票できない
    if (submission.playerId === voter.id) {
      socket.emit('errorMessage', { message: '自分のカードには投票できません。' });
      return;
    }

    gameState.votesReceived[voter.id] = submissionId;

    console.log(`Player ${voter.name} voted for submission #${submissionId}`);

    tryFinishVoting();
  });
  
  socket.on('restartGame', () => {
    const host = getHostPlayer();
    const player = getPlayerBySocket(socket);

    // ホスト以外 / プレイヤー不明 / ゲームが終わっていない場合は拒否
    if (!player || !host || player.id !== host.id) {
      socket.emit('errorMessage', { message: 'ホストのみゲームをリスタートできます。' });
      return;
    }
    if (gameState.phase !== 'finished') {
      socket.emit('errorMessage', { message: 'ゲーム終了後のみリスタートできます。' });
      return;
    }
    if (players.length < 2) {
      socket.emit('errorMessage', { message: 'プレイヤーが2人以上いる必要があります。' });
      return;
    }

    console.log('Game restarting by host:', player.name);

    // ゲーム状態リセット
    gameState = {
      phase: 'waiting',
      round: 0,
      currentPrompt: null,
      promptDeck: [],
      answerDeck: [],
      submissions: [],
      nextSubmissionId: 1,
      votesReceived: {}
    };

    // プレイヤー状態リセット（スコアと手札）
    players.forEach(p => {
      p.score = 0;
      p.hand = [];
    });

    // そのまま新ゲーム開始
    startGame();
  });

  

  socket.on('disconnect', () => {
    console.log('user disconnected', socket.id);
    const index = players.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      const [removed] = players.splice(index, 1);
      console.log(`Player left: ${removed.name}`);
      if (players.length === 0) {
        // 全員抜けたらゲームリセット
        gameState = {
          phase: 'waiting',
          round: 0,
          currentPrompt: null,
          promptDeck: [],
          answerDeck: [],
          submissions: [],
          nextSubmissionId: 1,
          votesReceived: {}
        };
        nextPlayerId = 1;
      }
      broadcastLobby();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
