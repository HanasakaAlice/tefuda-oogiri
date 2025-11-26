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

// お題
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

// 手札に使う回答カード
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
  phase: 'waiting',
  round: 0,
  currentPrompt: null,
  promptDeck: [],
  answerDeck: [],
  submissions: [],
  nextSubmissionId: 1,
  votesReceived: {},
  nextRoundReady: {},
  gameMode: 'draft'   // ★ 追加： 'draft' or 'custom'
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

  console.log('Game started, mode =', gameState.gameMode);

  // 山札準備（PROMPTS はどちらのモードでも使う）
  gameState.promptDeck = [...PROMPTS];
  shuffle(gameState.promptDeck);

  // 回答カード山札（draft モードで主に使用）
  gameState.answerDeck = [...ANSWER_CARDS];
  shuffle(gameState.answerDeck);

  players.forEach(p => {
    p.score = 0;
    p.hand = [];
    p.draftCount = 0;
    p.currentDraftOptions = [];
    p.initialHandSubmitted = false;
  });

  gameState.round = 0;
  gameState.submissions = [];
  gameState.votesReceived = {};
  gameState.nextSubmissionId = 1;
  gameState.nextRoundReady = {};

  if (gameState.gameMode === 'custom') {
    // ★ 自分で手札を作るモード
    startHandInputForAllPlayers();
  } else {
    // ★ デフォルト：ドラフトモード（いままで通り）
    gameState.phase = 'draft';
    startDraftForAllPlayers();
  }

  broadcastLobby();
}


// 山札から回答カードを1枚引く（足りなくなったらリシャッフル）
function drawAnswerCard() {
  if (gameState.answerDeck.length === 0) {
    gameState.answerDeck = [...ANSWER_CARDS];
    shuffle(gameState.answerDeck);
  }
  return gameState.answerDeck.pop();
}

// 特定プレイヤーに「2枚の候補」を送る
function sendDraftOptionsToPlayer(player) {
  if (player.draftCount >= HAND_SIZE) return;

  const option1 = drawAnswerCard();
  const option2 = drawAnswerCard();

  player.currentDraftOptions = [option1, option2];

  const socket = io.sockets.sockets.get(player.socketId);
  if (!socket) return;

  socket.emit('draftOptions', {
    picksDone: player.draftCount,   // 何枚取り終わってるか
    totalPicks: HAND_SIZE,
    options: [option1, option2]
  });
}

// 全プレイヤーに最初のドラフト候補を配る
function startDraftForAllPlayers() {
  players.forEach(p => {
    sendDraftOptionsToPlayer(p);
  });
}

function startHandInputForAllPlayers() {
  gameState.phase = 'handInput';
  console.log('Starting hand input phase');

  players.forEach(p => {
    p.hand = [];
    p.initialHandSubmitted = false;
  });

  players.forEach(p => {
    const socket = io.sockets.sockets.get(p.socketId);
    if (!socket) return;
    socket.emit('startHandInput', {
      handSize: HAND_SIZE
    });
  });
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
  gameState.nextRoundReady = {};  

  // お題を1つ引く（足りなくなったら再シャッフル）
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

    // 提出カードをシャッフル（ベース順序）
    const shuffled = [...gameState.submissions];
    shuffle(shuffled);

    // 各プレイヤーに「自分のカードかどうか」を付けて送る
    players.forEach(p => {
      const socket = io.sockets.sockets.get(p.socketId);
      if (!socket) return;

      const submissionsForThisPlayer = shuffled.map(s => ({
        submissionId: s.submissionId,
        text: s.text,
        isMine: s.playerId === p.id
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
    gameState.phase = 'result';

    const submissionMap = {};
    gameState.submissions.forEach(s => {
      submissionMap[s.submissionId] = s;
      s.votes = 0;
    });

    for (const [voterIdStr, submissionId] of Object.entries(gameState.votesReceived)) {
      const sub = submissionMap[submissionId];
      if (sub) {
        sub.votes += 1;
      }
    }

    gameState.submissions.forEach(s => {
      const owner = getPlayerById(s.playerId);
      if (owner) {
        owner.score += s.votes;
      }
    });

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

    // ★ 最終ラウンドかどうかで分岐
    if (gameState.round >= TOTAL_ROUNDS) {
    // 最終ラウンド：少し間をおいて自動でゲーム終了
    setTimeout(() => {
        endGame();
    }, 8000);
    } else {
    // それ以外：全員の「次ラウンドへ」ボタン待ち
    gameState.phase = 'result';
    gameState.nextRoundReady = {};
    }

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
      score: 0,
      draftCount: 0,
      currentDraftOptions: [],
      initialHandSubmitted: false   // ★ 追加
    };


    players.push(player);

    console.log(`Player joined: ${player.name} (${player.id})`);

    socket.emit('joined', {
      playerId: player.id
    });

    broadcastLobby();
  });

  socket.on('pickDraftCard', ({ choiceIndex }) => {
    const player = getPlayerBySocket(socket);
    if (!player) return;
    if (gameState.phase !== 'draft') return;

    if (!Array.isArray(player.currentDraftOptions) || player.currentDraftOptions.length !== 2) {
      socket.emit('errorMessage', { message: '現在選べるカードがありません。' });
      return;
    }

    if (choiceIndex !== 0 && choiceIndex !== 1) {
      socket.emit('errorMessage', { message: '不正な選択肢です。' });
      return;
    }

    const chosenText = player.currentDraftOptions[choiceIndex];

    // 手札に追加
    player.hand.push(chosenText);
    player.draftCount = (player.draftCount || 0) + 1;
    player.currentDraftOptions = [];

    // クライアント側に「何枚取り終わったか」を通知
    socket.emit('draftPicked', {
      picksDone: player.draftCount,
      totalPicks: HAND_SIZE
    });

    // まだ5枚に達していなければ、次の2枚を提示
    if (player.draftCount < HAND_SIZE) {
      sendDraftOptionsToPlayer(player);
    } else {
      // このプレイヤーはドラフト完了
      const allReady = players.every(p => (p.draftCount || 0) >= HAND_SIZE);
      if (allReady) {
        // 全員完了 → 本編開始
        console.log('All players finished drafting. Starting round 1.');
        gameState.round = 0;
        startNextRound();
      }
    }
  });

    socket.on('submitInitialHand', ({ answers }) => {
      const player = getPlayerBySocket(socket);
      if (!player) return;
      if (gameState.phase !== 'handInput') return;
      if (gameState.gameMode !== 'custom') return;

      if (!Array.isArray(answers) || answers.length !== HAND_SIZE) {
        socket.emit('errorMessage', { message: `手札はちょうど${HAND_SIZE}枚入力してください。` });
        return;
      }

      // 空の回答を弾きたい場合
      const trimmed = answers.map(a => String(a || '').trim());
      if (trimmed.some(t => t.length === 0)) {
        socket.emit('errorMessage', { message: '空欄の回答があります。すべて入力してください。' });
        return;
      }

      player.hand = trimmed;
      player.initialHandSubmitted = true;

      console.log(`Player ${player.name} submitted initial hand.`);

      // 全員出し終わったかチェック
      const allSubmitted = players.every(p => p.initialHandSubmitted);
      if (allSubmitted) {
        console.log('All players submitted custom hands. Starting round 1.');
        gameState.round = 0;
        startNextRound();   // ★ ここからはいつものラウンド処理
      } else {
        // 必要なら「送信完了だけど他の人待ち」を返してもよい
        socket.emit('infoMessage', { message: '手札を登録しました。他のプレイヤーを待っています。' });
      }
    });


    socket.on('readyNextRound', () => {
    const player = getPlayerBySocket(socket);
    if (!player) return;

    // 結果フェーズ以外 / 最終ラウンドでは受付しない
    if (gameState.phase !== 'result') return;
    if (gameState.round >= TOTAL_ROUNDS) return;

    if (!gameState.nextRoundReady) {
        gameState.nextRoundReady = {};
    }

    gameState.nextRoundReady[player.id] = true;

    const allReady = players.every(p => gameState.nextRoundReady[p.id]);

    if (allReady) {
        console.log('All players pressed "next round". Moving to next round.');
        startNextRound();
    }
    });



  socket.on('startGame', (data) => {
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

    const mode = data && data.mode === 'custom' ? 'custom' : 'draft';  // ★
    gameState.gameMode = mode;

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

    if (gameState.votesReceived[voter.id]) {
      socket.emit('errorMessage', { message: 'すでに投票済みです。' });
      return;
    }

    const submission = gameState.submissions.find(s => s.submissionId === submissionId);
    if (!submission) {
      socket.emit('errorMessage', { message: 'その回答は存在しません。' });
      return;
    }

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
    if (!player || !host || player.id !== host.id) {
      socket.emit('errorMessage', { message: 'ホストのみ再開できます。' });
      return;
    }

    console.log(`Game restarting by host: ${player.name}`);

    // いまのモードを退避（なければ draft）
    const currentMode = gameState.gameMode || 'draft';

    // プレイヤーの状態をリセット（席はそのまま）
    players.forEach(p => {
      p.score = 0;
      p.hand = [];
      p.draftCount = 0;
      p.currentDraftOptions = [];
      p.initialHandSubmitted = false;
    });

    // gameState を「待機中」にリセット（モードだけ引き継ぐ）
    gameState = {
      phase: 'waiting',
      round: 0,
      currentPrompt: null,
      promptDeck: [],
      answerDeck: [],
      submissions: [],
      nextSubmissionId: 1,
      votesReceived: {},
      nextRoundReady: {},
      gameMode: currentMode
    };

    // ★ ここでは startGame() は呼ばない！
    //   → 次のゲーム開始はホストが「ゲーム開始」ボタンを押したタイミングに任せる

    broadcastLobby();
  });



  socket.on('disconnect', () => {
    console.log('user disconnected', socket.id);
    const index = players.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      const [removed] = players.splice(index, 1);
      console.log(`Player left: ${removed.name}`);
      if (players.length === 0) {
        let gameState = {
          phase: 'waiting',
          round: 0,
          currentPrompt: null,
          promptDeck: [],
          answerDeck: [],
          submissions: [],
          nextSubmissionId: 1,
          votesReceived: {},
          nextRoundReady: {},
          gameMode: 'draft'   // ★ 追加： 'draft' or 'custom'
        };

        nextPlayerId = 1;
      }
      broadcastLobby();
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
