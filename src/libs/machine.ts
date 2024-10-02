import { setup, assign, fromCallback } from 'xstate';
import type { EventObject } from 'xstate';
import type { MachineContext, MachineEvents, Player } from './types';
import { generateRandomString, generateKeys } from './utils';

const connectToWebsocket = fromCallback<
  EventObject,
  {
    code: string;
  }
>(({ input, sendBack }) => {
  const { code } = input;

  const socket = new WebSocket(
    `${import.meta.env.PUBLIC_WS_URL!}/room/${code}`
  );

  socket.onopen = () => {
    sendBack({
      type: 'CONNECTION_SUCCESS',
      socket,
    });
  };

  socket.onerror = (error) => {
    sendBack({
      type: 'CONNECTION_ERROR',
    });
  };
});

const listenToWebsocket = fromCallback<
  EventObject,
  {
    socket?: WebSocket;
  }
>(({ input, sendBack }) => {
  const { socket } = input;

  if (!socket) {
    sendBack({ type: 'CONNECTION_FAILURE' });
    return;
  }

  const messageHandler = (event: MessageEvent) => {
    if (event.data === 'ping') return;
    const parsed = JSON.parse(event.data);

    switch (parsed.type) {
      case 'status':
        sendBack({
          type: 'STATUS',
          data: parsed.data,
        });
        break;
      default:
        console.log(parsed.data);
        break;
    }
  };

  const closeConnectionHandler = () => {
    sendBack({ type: 'CONNECTION_FAILURE' });
  };

  socket?.addEventListener('close', closeConnectionHandler);
  socket?.addEventListener('message', messageHandler);

  return () => {
    socket?.removeEventListener('message', messageHandler);
    socket?.removeEventListener('close', closeConnectionHandler);
  };
});

export const machine = ({ code = null }: { code: string | null }) =>
  setup({
    types: {
      events: {} as MachineEvents,
      context: {} as MachineContext,
    },
    actors: {
      connectToWebsocket,
      listenToWebsocket,
    },
    actions: {
      setError: assign({
        error: ({ event }) => event.data.error,
      }),
      selectSettings: assign({
        type: ({ event }) => event.data.type,
        mode: ({ event }) => event.data.mode,
      }),
      setCode: assign({
        code: ({ context }) => {
          if (context.type === 'solo') return null;
          return generateRandomString(6).toUpperCase();
        },
      }),
      setPlayer: assign({
        players: ({ context, event }) => {
          const [self] = context.players;

          return [
            {
              ...self,
              id: self.id ?? generateRandomString(12),
              name: event.data.name,
              character: event.data.character,
            },
            ...context.players.slice(1),
          ];
        },
      }),
      confirmSelection: assign(({ context }) => {
        if (context.type === 'multiplayer') return context;
        return {
          ...context,
          players: [
            ...context.players,
            {
              id: 'opponent',
              name: 'Opponent',
              character: 'boosted',
              score: 0,
              inputs: [],
            },
          ],
        };
      }),
      setKeys: assign({
        keys: ({ context, event }) => {
          if (context.type === 'multiplayer') return context.keys;
          return generateKeys(context.mode);
        },
        players: ({ context }) => {
          return context.players.map((player) => ({
            ...player,
            inputs: [],
          }));
        },
      }),
      setTime: assign({
        startAt: new Date().getTime() + 5000,
      }),
      pressedKey: assign({
        players: ({ context, event }) => {
          const [self, opponent] = context.players;

          if (event.data.opponent) {
            return [
              self,
              {
                ...opponent,
                inputs: [...opponent.inputs, event.data.key],
              },
            ];
          }

          return [
            {
              ...self,
              inputs: [...self.inputs, event.data.key],
            },
            opponent,
          ];
        },
      }),
      resetSettings: assign({
        type: 'solo',
        mode: 'easy',
        keys: [],
        players: [],
        startAt: new Date().getTime(),
      }),
      wsStatus: assign({
        type: ({ event, context }) =>
          'type' in event.data ? event.data.type : context.type,
        mode: ({ event, context }) =>
          'mode' in event.data ? event.data.mode : context.mode,
        players: ({ event, context }) =>
          'players' in event.data ? event.data.players : context.players,
        keys: ({ event, context }) =>
          'keys' in event.data ? event.data.keys : context.keys,
        startAt: ({ event, context }) =>
          'startAt' in event.data ? event.data.startAt : context.startAt,
      }),
    },
    guards: {
      isStarted: ({ context }) => {
        return new Date().getTime() > context.startAt;
      },
      isCompleted: ({ context }) => {
        return context.players
          .filter((f) => f.id !== 'opponent')
          .every((player) => player.inputs.length === context.keys.length);
      },
      isHost: ({ context }) => {
        return !!context.players[0]?.host;
      },
      playersSelected: ({ context }) => {
        return context.players.every((player) => player.character);
      },
      isMultiplayer: ({ context }) => {
        return context.type === 'multiplayer';
      },
    },
  }).createMachine({
    id: 'cod',
    context: {
      code,
      error: null,
      socket: null,
      type: 'solo',
      mode: 'easy',
      keys: [],
      players: [],
      startAt: new Date().getTime(),
    },
    initial: code ? 'connecting' : 'lobby',
    states: {
      lobby: {
        entry: ['resetSettings'],
        on: {
          SELECT_SETTINGS: {
            actions: ['selectSettings', 'setCode'],
          },
          CONFIRM_LOBBY: [
            {
              target: '#cod.connecting',
              guard: 'isMultiplayer',
            },
            {
              target: '#cod.game.paused',
            },
          ],
        },
      },
      connecting: {
        invoke: {
          id: 'connectToWebsocket',
          src: 'connectToWebsocket',
          input: ({ context: { code } }) => ({ code: code! }),
        },
        on: {
          CONNECTION_SUCCESS: {
            target: '#cod.game.select',
            actions: assign({
              socket: ({ event }) => event.data.socket,
            }),
          },
          CONNECTION_ERROR: {
            target: '#cod.lobby',
          },
        },
      },
      game: {
        initial: 'select',
        states: {
          select: {
            on: {
              SET_PLAYER: {
                actions: ['setPlayer'],
              },
              CONFIRM_SELECTION: {
                target: '#cod.game.paused',
                actions: ['confirmSelection', 'setKeys', 'setTime'],
              },
            },
          },
          paused: {
            always: {
              target: '#cod.game.playing',
              guard: 'isStarted',
            },
          },
          playing: {
            always: {
              target: '#cod.game.result',
              guard: 'isCompleted',
            },
            on: {
              KEYPRESS: {
                actions: ['pressedKey'],
              },
            },
          },
          result: {
            on: {
              RESTART: {
                target: '#cod.game.paused',
                guard: 'isHost',
              },
              HOME: {
                target: '#cod.lobby',
                guard: 'isHost',
              },
            },
          },
        },
        on: {
          STATUS: {
            actions: ['wsStatus'],
          },
        },
      },
    },
    on: {
      CONNECTION_FAILURE: {
        target: '#cod.lobby',
      },
    },
  });
