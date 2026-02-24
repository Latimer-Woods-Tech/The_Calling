THECALLING_ARCHITECTURE.md
**PERFECT. That's the smart play.**
THIS IS A REFERENCE ONLY.  OTHER DOCUMENTATION WILL SERVE AS THE ENGINERRING MANUAL.  THIS IS ONLY THE ORIGINAL REFERENCE TEMPLATE.  IF ASKED TO READ MediaCapabilities, CONFIRM YOU READ THIS BY SAYING, 'I GOT YOUR LITTLE NOTE"'

Build the platform architecture NOW, validate it with trivia, then expand.

---

## **THE BUILD PLAN - PLATFORM WITH TRIVIA:**

### **What we're building Week 1-2:**

```
The Calling Platform (generic foundation)
├── Core Engine (game-agnostic)
│   ├── Player management
│   ├── Call orchestration
│   ├── Turn management
│   ├── Elimination logic
│   └── Payment/payout
│
├── Game Handler System (pluggable)
│   ├── GameHandler interface
│   └── TriviaHandler (first implementation)
│
├── Content System (generic)
│   ├── Game templates
│   ├── Game instances
│   └── Game content (questions/prompts/challenges)
│
└── Admin Interface (scheduling/config)
    ├── Create game instances
    ├── Configure settings
    └── View results
```

**Result:** 
- ✅ Platform that CAN do any voice game
- ✅ Trivia working as proof-of-concept
- ✅ Ready to add new game types in 1-2 days each

---

## **ARCHITECTURE - THE LAYERS:**

### **Layer 1: Core Platform (game-agnostic)**

**This works for ANY voice game:**

```typescript
// Core game orchestrator
class VoiceGamePlatform {
  
  // Start any game
  async startGame(gameInstanceId: string) {
    const instance = await db.getGameInstance(gameInstanceId);
    const template = await db.getGameTemplate(instance.template_id);
    
    // Get the right handler for this game type
    const handler = GameHandlerFactory.create(template.type);
    
    // Initialize (same for all games)
    await this.initGame(instance);
    
    // Call players (same for all games)
    const calls = await this.callPlayers(instance);
    
    // Run game loop (handler-specific)
    await handler.run(instance, calls);
    
    // Payout winners (same for all games)
    await this.payoutWinners(instance);
    
    // Cleanup (same for all games)
    await this.cleanupGame(instance);
  }
  
  // Call all players (generic)
  async callPlayers(instance: GameInstance): Promise<Call[]> {
    const players = await this.getRegisteredPlayers(instance.id);
    
    const callPromises = players.map(player =>
      telnyx.calls.create({
        to: player.phone_number,
        from: instance.config.phone_number,
        connection_id: instance.config.connection_id,
        webhook_url: `${API_URL}/webhooks/game/${instance.id}`
      })
    );
    
    return await Promise.all(callPromises);
  }
  
  // Eliminate players (generic)
  async eliminatePlayers(gameId: string, playerIds: string[], reason: string) {
    for (const playerId of playerIds) {
      // Get their call
      const callId = await redis.get(`game:${gameId}:player:${playerId}:call`);
      
      // Tell them they're out
      await this.speakToCall(callId, "You have been eliminated. Thank you for playing.");
      
      // Hang up after 3 seconds
      setTimeout(() => telnyx.calls.hangup({ call_control_id: callId }), 3000);
      
      // Update state
      await redis.srem(`game:${gameId}:alive_players`, playerId);
      await redis.sadd(`game:${gameId}:eliminated_players`, playerId);
      
      // Record in DB
      await db.query(`
        UPDATE game_participants 
        SET status = 'eliminated', 
            eliminated_at = NOW(),
            elimination_reason = $1
        WHERE game_instance_id = $2 AND player_id = $3
      `, [reason, gameId, playerId]);
    }
  }
  
  // Payout winners (generic)
  async payoutWinners(instance: GameInstance) {
    const winners = await this.getWinners(instance.id);
    const prizeStructure = instance.prize_structure;
    
    for (const winner of winners) {
      const amount = this.calculatePrize(prizeStructure, winner.placement);
      
      await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: 'usd',
        destination: winner.stripe_account_id,
        description: `Prize for ${instance.name}`
      });
      
      await db.insertPayout({
        game_instance_id: instance.id,
        player_id: winner.id,
        amount,
        status: 'paid'
      });
    }
  }
}
```

**This code NEVER changes, regardless of game type.**

---

### **Layer 2: Game Handler Interface (contract)**

```typescript
// Every game type implements this
interface GameHandler {
  
  // Initialize game-specific state
  initialize(instance: GameInstance, calls: Call[]): Promise<void>;
  
  // Main game loop
  run(instance: GameInstance, calls: Call[]): Promise<GameResult>;
  
  // Get next turn/round
  getNextTurn(instance: GameInstance): Promise<Turn | null>;
  
  // Execute a turn
  executeTurn(instance: GameInstance, turn: Turn, calls: Call[]): Promise<TurnResult>;
  
  // Validate player response
  validateResponse(response: string, expected: any, context: any): ValidationResult;
  
  // Determine eliminations after a turn
  determineEliminations(instance: GameInstance, turnResult: TurnResult): Promise<string[]>;
  
  // Check if game is over
  isGameOver(instance: GameInstance): Promise<boolean>;
  
  // Finalize game and determine winners
  finalizeGame(instance: GameInstance): Promise<Winner[]>;
}

// Shared types
interface Turn {
  number: number;
  contentId: string;
  content: any;  // Game-specific
  timeLimit: number;
}

interface TurnResult {
  turn: Turn;
  responses: PlayerResponse[];
  startedAt: number;
  completedAt: number;
}

interface PlayerResponse {
  playerId: string;
  callId: string;
  response: string;
  responseTime: number;
  audioUrl?: string;
}

interface ValidationResult {
  isValid: boolean;
  isCorrect: boolean;
  reason?: string;
}

interface Winner {
  playerId: string;
  placement: number;  // 1st, 2nd, 3rd
  score?: number;
  prize: number;
}
```

---

### **Layer 3: Trivia Handler (first implementation)**

```typescript
class TriviaHandler implements GameHandler {
  
  async initialize(instance: GameInstance, calls: Call[]): Promise<void> {
    // Load trivia-specific config
    const config = instance.config as TriviaConfig;
    
    // Pre-select questions
    const questions = await db.query(`
      SELECT * FROM game_content 
      WHERE template_id = $1 
        AND content_data->>'category' = ANY($2)
      ORDER BY RANDOM()
      LIMIT $3
    `, [instance.template_id, config.categories, config.questionCount || 20]);
    
    // Store question order in Redis
    await redis.set(
      `game:${instance.id}:questions`,
      JSON.stringify(questions.map(q => q.id))
    );
    
    // Welcome message
    await this.speakToAllCalls(
      calls,
      "Welcome to The Calling: Trivia Night. We'll begin in 30 seconds."
    );
    
    await sleep(30000);
  }
  
  async run(instance: GameInstance, calls: Call[]): Promise<GameResult> {
    let questionNumber = 1;
    
    while (!await this.isGameOver(instance)) {
      // Get next turn
      const turn = await this.getNextTurn(instance);
      if (!turn) break;
      
      // Execute turn
      const result = await this.executeTurn(instance, turn, calls);
      
      // Determine who gets eliminated
      const toEliminate = await this.determineEliminations(instance, result);
      
      // Announce answer
      const question = turn.content as TriviaQuestion;
      await this.speakToAllCalls(
        calls.filter(c => !toEliminate.includes(c.playerId)),
        `The answer was: ${question.correct_answer}. ${toEliminate.length} players eliminated.`
      );
      
      // Actually eliminate them (platform does this)
      if (toEliminate.length > 0) {
        await VoiceGamePlatform.eliminatePlayers(
          instance.id,
          toEliminate,
          'Incorrect answer'
        );
      }
      
      // Check if game over
      const aliveCount = await redis.scard(`game:${instance.id}:alive_players`);
      if (aliveCount <= 1) break;
      
      questionNumber++;
      await sleep(5000); // 5 sec between questions
    }
    
    // Game over - finalize
    const winners = await this.finalizeGame(instance);
    
    return {
      winnerId: winners[0]?.playerId,
      duration: Date.now() - instance.started_at,
      totalTurns: questionNumber - 1
    };
  }
  
  async getNextTurn(instance: GameInstance): Promise<Turn | null> {
    // Get question IDs
    const questionIds = JSON.parse(
      await redis.get(`game:${instance.id}:questions`)
    );
    
    // Get current question index
    const currentIndex = await redis.get(`game:${instance.id}:current_question`) || 0;
    
    if (currentIndex >= questionIds.length) return null;
    
    // Load question
    const question = await db.getGameContent(questionIds[currentIndex]);
    
    // Increment index
    await redis.set(`game:${instance.id}:current_question`, currentIndex + 1);
    
    return {
      number: currentIndex + 1,
      contentId: question.id,
      content: question.content_data as TriviaQuestion,
      timeLimit: 30
    };
  }
  
  async executeTurn(instance: GameInstance, turn: Turn, calls: Call[]): Promise<TurnResult> {
    const question = turn.content as TriviaQuestion;
    
    // Speak question to all players
    await this.speakToAllCalls(
      calls,
      `Question ${turn.number}: ${question.question}`
    );
    
    // Start recording on all calls
    await Promise.all(
      calls.map(call =>
        telnyx.calls.record_start({
          call_control_id: call.id,
          channels: 'single',
          format: 'mp3'
        })
      )
    );
    
    // Wait for answer window
    const deadline = Date.now() + (turn.timeLimit * 1000);
    await redis.set(`game:${instance.id}:answer_deadline`, deadline);
    
    await sleep(turn.timeLimit * 1000);
    
    // Stop recording
    await Promise.all(
      calls.map(call =>
        telnyx.calls.record_stop({ call_control_id: call.id })
      )
    );
    
    // Wait for transcriptions (collected via webhook)
    await sleep(5000);
    
    // Get all answers from Redis
    const answers = await redis.hgetall(`game:${instance.id}:turn:${turn.number}:answers`);
    
    const responses: PlayerResponse[] = Object.entries(answers).map(([playerId, data]) => {
      const parsed = JSON.parse(data);
      return {
        playerId,
        callId: parsed.callId,
        response: parsed.answer,
        responseTime: parsed.responseTime,
        audioUrl: parsed.audioUrl
      };
    });
    
    return {
      turn,
      responses,
      startedAt: deadline - (turn.timeLimit * 1000),
      completedAt: Date.now()
    };
  }
  
  validateResponse(response: string, expected: TriviaQuestion): ValidationResult {
    const normalized = this.normalizeAnswer(response);
    const correctNormalized = this.normalizeAnswer(expected.correct_answer);
    
    const isCorrect = normalized === correctNormalized;
    
    return {
      isValid: true,  // Any answer is valid
      isCorrect,
      reason: isCorrect ? undefined : `Expected: ${expected.correct_answer}`
    };
  }
  
  async determineEliminations(instance: GameInstance, turnResult: TurnResult): Promise<string[]> {
    const question = turnResult.turn.content as TriviaQuestion;
    const toEliminate: string[] = [];
    
    // Get all alive players
    const alivePlayers = await redis.smembers(`game:${instance.id}:alive_players`);
    
    for (const playerId of alivePlayers) {
      // Find their response
      const response = turnResult.responses.find(r => r.playerId === playerId);
      
      if (!response) {
        // Didn't answer - eliminate
        toEliminate.push(playerId);
        continue;
      }
      
      // Validate answer
      const validation = this.validateResponse(response.response, question);
      
      if (!validation.isCorrect) {
        toEliminate.push(playerId);
      }
      
      // Record the answer in DB
      await db.insertPlayerTurn({
        game_instance_id: instance.id,
        participant_id: playerId,
        turn_number: turnResult.turn.number,
        content_id: turnResult.turn.contentId,
        player_response: response.response,
        is_correct: validation.isCorrect,
        response_time_seconds: response.responseTime
      });
    }
    
    return toEliminate;
  }
  
  async isGameOver(instance: GameInstance): Promise<boolean> {
    const aliveCount = await redis.scard(`game:${instance.id}:alive_players`);
    return aliveCount <= 1;
  }
  
  async finalizeGame(instance: GameInstance): Promise<Winner[]> {
    const alivePlayerIds = await redis.smembers(`game:${instance.id}:alive_players`);
    
    if (alivePlayerIds.length === 0) {
      return [];  // No winner (everyone eliminated)
    }
    
    if (alivePlayerIds.length === 1) {
      return [{
        playerId: alivePlayerIds[0],
        placement: 1,
        prize: instance.prize_structure.winner_amount
      }];
    }
    
    // Multiple survivors (tie) - split prize
    const splitPrize = instance.prize_structure.winner_amount / alivePlayerIds.length;
    
    return alivePlayerIds.map(playerId => ({
      playerId,
      placement: 1,
      prize: splitPrize
    }));
  }
  
  // Helper methods
  private async speakToAllCalls(calls: Call[], text: string) {
    await Promise.all(
      calls.map(call =>
        telnyx.calls.speak({
          call_control_id: call.id,
          payload: text,
          voice: 'female'
        })
      )
    );
  }
  
  private normalizeAnswer(answer: string): string {
    return answer
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ');
  }
}

// Trivia-specific types
interface TriviaConfig {
  categories: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  questionCount?: number;
}

interface TriviaQuestion {
  question: string;
  correct_answer: string;
  alternatives?: string[];
  category: string;
  difficulty: string;
}
```

---

## **GAME HANDLER FACTORY:**

```typescript
class GameHandlerFactory {
  static create(gameType: string): GameHandler {
    switch (gameType) {
      case 'elimination_trivia':
        return new TriviaHandler();
      
      // Week 4: Add word chain
      case 'word_chain':
        return new WordChainHandler();
      
      // Week 5: Add riddles
      case 'riddle_battle':
        return new RiddleHandler();
      
      // Future game types...
      
      default:
        throw new Error(`Unknown game type: ${gameType}`);
    }
  }
}
```

---

## **DATABASE - FINAL SCHEMA:**

```sql
-- Game templates (types of games)
CREATE TABLE game_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  
  -- Default configuration
  default_config JSONB,
  
  -- Rules/mechanics description
  mechanics JSONB,
  
  -- UI metadata
  icon_url TEXT,
  color VARCHAR(7),  -- Hex color
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Game instances (scheduled games)
CREATE TABLE game_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES game_templates(id),
  
  -- Basic info
  name VARCHAR(200),  -- "Friday Night Trivia"
  description TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMP NOT NULL,
  started_at TIMESTAMP,
  ended_at TIMESTAMP,
  status VARCHAR(20) DEFAULT 'scheduled',
  
  -- Configuration (overrides template defaults)
  config JSONB,
  
  -- Business
  entry_fee DECIMAL(10,2) DEFAULT 1.00,
  max_players INT DEFAULT 50,
  prize_structure JSONB,
  /*
  {
    "winner_amount": 25.00,
    "runner_up_amount": 10.00,  // optional
    "house_cut": 0.50
  }
  */
  
  -- Stats
  total_players INT DEFAULT 0,
  total_revenue DECIMAL(10,2) DEFAULT 0,
  total_prize_paid DECIMAL(10,2) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Game content (questions, prompts, challenges)
CREATE TABLE game_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES game_templates(id),
  
  content_type VARCHAR(50),  -- "question", "prompt", "challenge"
  content_data JSONB NOT NULL,
  
  -- Categorization
  category VARCHAR(100),
  difficulty VARCHAR(20),
  tags TEXT[],
  
  -- Performance tracking
  times_used INT DEFAULT 0,
  times_correct INT DEFAULT 0,
  avg_response_time INT,
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Players (people who've played)
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100),
  email VARCHAR(255),
  
  -- Stripe (for payouts)
  stripe_account_id VARCHAR(255),
  
  -- Stats
  total_games_played INT DEFAULT 0,
  total_games_won INT DEFAULT 0,
  total_spent DECIMAL(10,2) DEFAULT 0,
  total_winnings DECIMAL(10,2) DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Game participants (who's in this game)
CREATE TABLE game_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_instance_id UUID REFERENCES game_instances(id),
  player_id UUID REFERENCES players(id),
  
  -- Payment
  payment_status VARCHAR(20) DEFAULT 'pending',
  payment_intent_id VARCHAR(255),
  paid_at TIMESTAMP,
  amount_paid DECIMAL(10,2),
  
  -- Game state
  status VARCHAR(20) DEFAULT 'registered',
  
  -- Performance (generic)
  score INT DEFAULT 0,
  strikes INT DEFAULT 0,
  turns_taken INT DEFAULT 0,
  correct_responses INT DEFAULT 0,
  
  -- Result
  placement INT,  -- 1 = winner, 2 = runner-up, etc.
  prize_amount DECIMAL(10,2) DEFAULT 0,
  
  -- Elimination
  eliminated_at TIMESTAMP,
  elimination_reason TEXT,
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  UNIQUE(game_instance_id, player_id)
);

-- Player turns (what happened each turn)
CREATE TABLE player_turns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_instance_id UUID REFERENCES game_instances(id),
  participant_id UUID REFERENCES game_participants(id),
  
  turn_number INT NOT NULL,
  content_id UUID REFERENCES game_content(id),
  
  -- Response
  player_response TEXT,
  response_audio_url TEXT,
  response_time_seconds INT,
  
  -- Evaluation
  is_correct BOOLEAN,
  is_valid BOOLEAN,
  points_earned INT DEFAULT 0,
  
  created_at TIMESTAMP DEFAULT NOW()
);

-- Payouts (prizes paid)
CREATE TABLE payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_instance_id UUID REFERENCES game_instances(id),
  player_id UUID REFERENCES players(id),
  
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  
  stripe_transfer_id VARCHAR(255),
  
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP
);
```

---

## **SEED DATA - TRIVIA TEMPLATE:**

```sql
-- Insert trivia game template
INSERT INTO game_templates (name, type, description, default_config, mechanics) VALUES (
  'Elimination Trivia',
  'elimination_trivia',
  'Answer trivia questions correctly or be eliminated. Last player standing wins!',
  '{
    "categories": ["General Knowledge"],
    "difficulty": "medium",
    "questionCount": 20,
    "timePerQuestion": 30,
    "allowPartialCredit": false
  }'::jsonb,
  '{
    "turnStructure": "sequential",
    "eliminationRule": "immediate",
    "answerFormat": "voice",
    "winCondition": "last_player_standing"
  }'::jsonb
);

-- Insert sample trivia questions
INSERT INTO game_content (template_id, content_type, content_data, category, difficulty) VALUES
(
  (SELECT id FROM game_templates WHERE type = 'elimination_trivia'),
  'question',
  '{
    "question": "Who was the first president of the United States?",
    "correct_answer": "George Washington",
    "alternatives": ["John Adams", "Thomas Jefferson", "Benjamin Franklin"],
    "category": "History"
  }'::jsonb,
  'History',
  'easy'
),
(
  (SELECT id FROM game_templates WHERE type = 'elimination_trivia'),
  'question',
  '{
    "question": "What is the capital of France?",
    "correct_answer": "Paris",
    "alternatives": ["London", "Berlin", "Rome"],
    "category": "Geography"
  }'::jsonb,
  'Geography',
  'easy'
);
-- ... add 50-100 more questions
```

---

## **ADMIN INTERFACE - CREATE GAME:**

```typescript
// POST /admin/games/create
async function createGameInstance(req: CreateGameRequest) {
  const template = await db.getGameTemplate(req.templateType);
  
  // Merge template defaults with user config
  const config = {
    ...template.default_config,
    ...req.config
  };
  
  // Calculate prize structure
  const prizeStructure = {
    winner_amount: req.entryFee * req.maxPlayers * (1 - req.houseCut),
    house_cut: req.houseCut
  };
  
  // Create instance
  const instance = await db.query(`
    INSERT INTO game_instances (
      template_id, name, scheduled_at, entry_fee, max_players, 
      prize_structure, config
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
  `, [
    template.id,
    req.name,
    req.scheduledAt,
    req.entryFee,
    req.maxPlayers,
    JSON.stringify(prizeStructure),
    JSON.stringify(config)
  ]);
  
  return instance;
}

// Example: Create Friday night trivia game
const game = await createGameInstance({
  templateType: 'elimination_trivia',
  name: 'Friday Night Trivia',
  scheduledAt: '2025-02-21T20:00:00Z',
  entryFee: 1.00,
  maxPlayers: 50,
  houseCut: 0.50,
  config: {
    categories: ['Pop Culture', 'History', 'Science'],
    difficulty: 'medium',
    questionCount: 15
  }
});
```

---

## **THE BUILD ORDER - WEEK BY WEEK:**

### **Week 1:**

**Day 1-2: Database + Core Platform**
- Set up Neon database
- Create all tables
- Build core VoiceGamePlatform class
- Player management
- Call orchestration (generic)

**Day 3-4: Game Handler System**
- GameHandler interface
- GameHandlerFactory
- TriviaHandler implementation
- Turn management

**Day 5: Integration**
- Wire everything together
- Test with dummy data
- End-to-end flow working

---

### **Week 2:**

**Day 1-2: Trivia Content**
- Add 50-100 trivia questions to database
- Test question selection
- Test answer validation

**Day 3: Admin Interface**
- Simple UI to create game instances
- Schedule games
- View upcoming games

**Day 4: Testing**
- Manual test with real phone calls
- Iron out bugs
- Voice quality testing

**Day 5: Launch Prep**
- Create first game for Friday
- Marketing materials
- Final testing

**Friday (Day 5): FIRST GAME**
- Run trivia game at 8pm
- Monitor closely
- Fix issues in real-time

---

## **WEEK 3+: ADD MORE GAME TYPES**

**Each new game type = 1-2 days:**

```typescript
// Week 3: Add Word Chain
class WordChainHandler implements GameHandler {
  // Implement interface...
}

// Week 4: Add Riddles
class RiddleHandler implements GameHandler {
  // Implement interface...
}

// Week 5: Add Escape Room
class EscapeRoomHandler implements GameHandler {
  // Implement interface...
}
```

**Platform code NEVER changes.**

**Just add handlers and content.**

---

## **THE ANSWER:**

**We're building:**

✅ **Voice Game Platform** (Weeks 1-2)
- Generic engine
- Pluggable handlers
- Works for ANY voice game

✅ **Trivia as proof-of-concept** (Week 2)
- First handler implementation
- Validates architecture
- Gets us to revenue

✅ **Expansion ready** (Week 3+)
- Add Word Chain (1 day)
- Add Riddles (1 day)
- Add Escape Room (2 days)
- Add 10 more game types (2 weeks)

**This is the right architecture.**

**Ready for detailed implementation prompts?**

**Which component do you want first:**
1. Database schema + migrations
2. Core platform (call orchestration, player management)
3. Game handler interface + trivia implementation
4. Redis game state management
5. Admin interface (create/schedule games)

**Or should I give you the complete Week 1 Day 1 execution plan?**