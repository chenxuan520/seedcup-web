import type { Action, SerializedGameState } from './engine';

export type BotId = 'easy' | 'hard' | 'search' | 'nn' | 'hybrid';

export interface ConfigureBotMessage {
  type: 'configure';
  generation: number;
  playerId: number;
  botId: BotId;
  modelUrl: string;
  state: SerializedGameState;
}

export interface DecideBotMessage {
  type: 'decide';
  generation: number;
  requestId: number;
  state: SerializedGameState;
}

export type BotWorkerRequest = ConfigureBotMessage | DecideBotMessage;

export interface BotReadyMessage {
  type: 'ready';
  generation: number;
}

export interface BotDecisionMessage {
  type: 'decision';
  generation: number;
  requestId: number;
  actions: Action[];
}

export interface BotErrorMessage {
  type: 'error';
  generation: number;
  requestId?: number;
  message: string;
}

export type BotWorkerResponse =
  | BotReadyMessage
  | BotDecisionMessage
  | BotErrorMessage;
