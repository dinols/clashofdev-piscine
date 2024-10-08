import { setup, assign, fromCallback } from "xstate";
import type { EventObject } from "xstate";
import type { GameType, MachineContext, MachineEvents, Player } from "./types";
import { generateRandomString, generateKeys } from "./utils";

const connectToWebsocket = fromCallback<
  EventObject,
  {
    code: string;
    playerId: string;
  }
>(({ input, sendBack }) => {
  const { code, playerId } = input;

  const socket = new WebSocket(
    `${import.meta.env.PUBLIC_WS_URL!}/room?gameId=${code}&playerId=${playerId}`
  );

  socket.onopen = () => {
    sendBack({
      type: "CONNECTION_SUCCESS",
      data: {
        socket,
      },
    });
  };

  socket.onerror = (error) => {
    sendBack({
      type: "CONNECTION_ERROR",
    });
  };
});

const listenToWebsocket = fromCallback<
  EventObject,
  {
    socket: WebSocket | null;
    type: GameType;
  }
>(({ input, sendBack }) => {
  const { socket } = input;

  if (!socket && input.type === "multiplayer") {
    sendBack({ type: "CONNECTION_FAILURE" });
    return;
  }

  const messageHandler = (event: MessageEvent) => {
    if (event.data === "ping") return;
    const parsed = JSON.parse(event.data);

    switch (parsed.type) {
      default:
        console.log(parsed.data);
        break;
    }
  };

  const closeConnectionHandler = () => {
    sendBack({ type: "CONNECTION_FAILURE" });
  };

  socket?.addEventListener("close", closeConnectionHandler);
  socket?.addEventListener("message", messageHandler);

  return () => {
    socket?.removeEventListener("message", messageHandler);
    socket?.removeEventListener("close", closeConnectionHandler);
  };
});

export const machine = ({
  gameId = null,
  playerId = null,
}: {
  gameId: string | null;
  playerId: string | null;
}) =>
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
        type: ({ event, context }) =>
          "type" in event.data ? event.data.type : context.type,
        mode: ({ event, context }) =>
          "mode" in event.data ? event.data.mode : context.mode,
      }),
      setPlayer: assign({
        players: ({ context, event }) => {
          if (event.data.playerId) {
            return context.players.map((player) => {
              if (player.id === event.data.playerId) {
                return {
                  ...player,
                  character: event.data.character,
                  inputs: [],
                };
              }
              return player;
            });
          } else if (!context.players.find((f) => f.id === context.playerId)) {
            return [
              ...context.players,
              {
                id: context.playerId,
                name: event.data.name ?? "Player 1",
                character: event.data.character ?? "",
                inputs: [],
                host: context.players.length === 0,
              },
            ];
          }

          return context.players.map((player) => {
            if (player.id === context.playerId) {
              return {
                ...player,
                name: event.data.name ?? player.name ?? "",
                character: event.data.character ?? player.character ?? "",
              };
            }

            return player;
          });
        },
      }),
      confirmLobby: assign({
        players: ({ context }) => {
          return [
            {
              id: context.playerId,
              name: "Player 1",
              character: "",
              inputs: [],
              host: true,
            },
            {
              id:
                context.type === "solo" ? "opponent" : generateRandomString(16),
              character: context.type === "solo" ? "boosted" : "",
              name: "Player 2",
              inputs: [],
            },
          ];
        },
        code: ({ context }) => {
          const code = generateRandomString(6).toUpperCase();
          if (context.type === "multiplayer") {
            fetch(
              `${import.meta.env.PUBLIC_WS_URL!}/create-game?gameId=${code}&playerId=${context.playerId}&mode=${context.mode}`,
              {
                method: "POST",
              }
            );
          }
          return code;
        },
      }),
      confirmSelection: assign(({ context }) => {
        // TODO Emit to server
        return context;
      }),
      setKeys: assign({
        keys: ({ context, event }) => {
          if (context.type === "multiplayer") return context.keys;
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
        startAt: new Date().getTime(),
      }),
      pressedKey: assign({
        players: ({ context, event }) => {
          return context.players.map((player) => {
            if (player.id === context.playerId) {
              if (player.inputs.length === context.keys.length) return player;

              const isCorrect =
                event.data.key.toLowerCase() ===
                context.keys[player.inputs.length].toLowerCase();
              if (!isCorrect) {
                // TODO If multi, emit to server
                window.dispatchEvent(new CustomEvent(`${player.id}-error`));
              } else {
                window.dispatchEvent(new CustomEvent(`opponent-error`));
              }

              return {
                ...player,
                inputs: [...player.inputs, event.data.key],
                winner: false,
                score: 0,
              };
            }

            return player;
          });
        },
      }),
      assignWinner: assign({
        players: ({ context }) => {
          if (context.type === "multiplayer") {
            // TODO With score
            return context.players;
          }

          return context.players.map((player) => {
            if (player.id === "opponent") return player;

            const correctInputs = player.inputs.filter(
              (input, index) => input === context.keys[index]
            ).length;

            return {
              ...player,
              winner: correctInputs >= Math.ceil(context.keys.length / 2) + 1,
            };
          });
        },
      }),
      resetSettings: assign({
        type: "solo",
        mode: "easy",
        keys: [],
        players: [],
        startAt: new Date().getTime(),
      }),
      wsStatus: assign({
        playerId: ({ event, context }) =>
          "playerId" in event.data ? event.data.playerId : context.playerId,
        type: ({ event, context }) =>
          "type" in event.data ? event.data.type : context.type,
        mode: ({ event, context }) =>
          "mode" in event.data ? event.data.mode : context.mode,
        players: ({ event, context }) =>
          "players" in event.data ? event.data.players : context.players,
        keys: ({ event, context }) =>
          "keys" in event.data ? event.data.keys : context.keys,
        startAt: ({ event, context }) =>
          "startAt" in event.data ? event.data.startAt : context.startAt,
      }),
    },
    guards: {
      isStarted: ({ context }) => {
        return new Date().getTime() > context.startAt;
      },
      isCompleted: ({ context }) => {
        if (context.type === "multiplayer") {
          return context.players.every(
            (player) =>
              player.inputs.length > 0 &&
              player.inputs.length === context.keys.length
          );
        }

        return context.players
          .filter((f) => f.id !== "opponent")
          .every((player) => {
            const correctInputs = player.inputs.filter(
              (input, index) => input === context.keys[index]
            ).length;
            const incorrectInputs = player.inputs.filter(
              (input, index) => input !== context.keys[index]
            ).length;

            return (
              correctInputs >= Math.ceil(context.keys.length / 2) + 1 ||
              incorrectInputs >= Math.ceil(context.keys.length / 2)
            );
          });
      },
      isHost: ({ context }) => {
        return (
          context.players.find((player) => player.host)?.id === context.playerId
        );
      },
      playersSelected: ({ context }) => {
        if (context.type === "multiplayer") {
          const isHost =
            context.players.find((player) => player.host)?.id ===
            context.playerId;
          const bothSelected =
            context.players.filter((player) => !!player.character).length === 2;
          return isHost && bothSelected;
        }
        return context.players
          .filter((f) => f.id !== "opponent")
          .every((player) => !!player.character);
      },
      isMultiplayer: ({ context }) => {
        return context.type === "multiplayer";
      },
      hasCode: ({ context }) => {
        return !!context.code;
      },
    },
    delays: {
      timeout: ({ context }) => {
        if (context.mode === "hard") {
          return 10000;
        }

        return 30000;
      },
    },
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QGMD2EDEBhA8gOTwFEsAVASXwH0AxAQTIBkBVAJUIG0AGAXUVAAdUsAJYAXYagB2fEAA9EAFgBMAGhABPRAA4AjADoArJ2MmjSgJwKdBgL421aCHoA2qAEZv1GAMqEGxEkpfEnI8AHFvLl4kEEERcSkZeQQdJX0lAGZUgy0lADZzJU4srTVNBAKlPQB2HQyFXK1OLRaDczsHdBd3T2x8ajIWAFlKBhwAIXGATSiZOLEJaRjkhQUMvRNOJSsdc3NOPLqyxCKq7b29pWrzHRbqrQ6QR26PL1w8AeHRien2HWiBEIFollic8pxDHklAZ6kpdM0MscEFo2hsMnlVgprhiDHVHs80JJJGBkOJJFA+gQAhQ8EEmFgsIRvJEeHMgQklqBkgZVBpEDpOEY9PkLOZaqtcvd8V1CcTScJyZSiKQaZRCCwWDgWLMYvMOUlFGsNiZtjpdvtDoi+QhoVVqgoLtVquixQ97E8ulAAIYAWzAPhItBITBZANi7MWBpS1nWxTqGS2cLFqSR1U41RqDr2CjyPIMBgx0qc3r9elgYGcJNEPkIgQACgxaFN1TrAfFI6CEOYeXoMemdFDbuZDkixeYaloMastjCFG0i3oS2AyxWq5TPiNfP4VfhW+H2yCufyBesstDuxkitctNUkSf9ILzJP7QY56tbO7nku9PwvQBXctMD3PUOyPaMbhqeoHW2BQDknO8in0Z1uzWKE7kyBdv34ZwvXUBUKQAaUIKY6zYZlgIjQ85EQcEDA2e5bk4PZ02UcwEIxYUB2aGFoU4HRqkw31l2w3D8IwCiD05aiEHtLQ9AaVYMi0DJzHRNoDDvB08kMFF9h5VJnQyQTSxEvDFT+MMQKo5JZPkrRFOU1Tc27O9LwhTIUIyaoMX42pjOXAAnOA-2casyMDFgSAk4EpOSM1ij0M91Lc69b2tHQGgzG5CgTZ1OCsFp-L0ILYBC6sAAkcCGDhWV1SjYrBCEC2hWF4WUpEMQzc49kOSxvIEx5JHQOAZEcNlJKjABaPIkWm41NgW4w4QXVxXnGmKoyxJFcghM0xThBplLPBdZSrfD1v1TtlCRNIM2qIxjCaLzhzaN1OmLISLtA6T8wzdNdCaZj7QsVMURqOM6i0G57hzIry0rUkvusxBXT0Ro0isLTBTS8oBSaSDuzyS8cXtHQit-ADICRhqUgyHJEvu1ImJhpiNOtG91iKLI6ksK8b3JnCzKgamoyhdY1nugx7QdA5VNc3M9AHQp8oLZQ5yKkqypFzsnwhWp0UvOoeSuUp0odBQ0bpm8bgBqc7DsIA */
    id: "cod",
    context: {
      code: gameId ?? null,
      playerId: playerId ?? generateRandomString(16),
      error: null,
      socket: null,
      type: "solo",
      mode: "easy",
      keys: [],
      players: [],
      startAt: new Date().getTime(),
    },
    initial: "loading",
    states: {
      loading: {
        after: {
          2500: [
            {
              target: "#cod.connecting",
              guard: "hasCode",
            },
            {
              target: "#cod.lobby",
            },
          ],
        },
      },
      lobby: {
        entry: ["resetSettings"],
        on: {
          SELECT_SETTINGS: {
            actions: ["selectSettings"],
          },
          CONFIRM_LOBBY: [
            {
              target: "#cod.connecting",
              actions: "confirmLobby",
              guard: "isMultiplayer",
            },
            {
              target: "#cod.select",
              actions: "confirmLobby",
            },
          ],
        },
      },
      connecting: {
        invoke: {
          id: "connectToWebsocket",
          src: "connectToWebsocket",
          input: ({ context: { code, playerId } }) => ({
            code: code!,
            playerId,
          }),
        },
        on: {
          CONNECTION_SUCCESS: {
            target: "#cod.select",
            actions: assign({
              socket: ({ event }) => event.data.socket,
              type: "multiplayer",
            }),
          },
          CONNECTION_ERROR: {
            target: "#cod.lobby",
          },
        },
      },
      select: {
        invoke: {
          id: "listenToWebsocket",
          src: "listenToWebsocket",
          input: ({ context: { socket, type } }) => ({
            socket,
            type: type!,
          }),
        },
        on: {
          SET_PLAYER: {
            actions: ["setPlayer"],
          },
          CONFIRM_SELECTION: {
            target: "#cod.game.paused",
            actions: ["confirmSelection", "setKeys"],
            guard: "playersSelected",
          },
        },
      },
      game: {
        initial: "paused",
        states: {
          paused: {
            after: {
              3500: {
                target: "#cod.game.playing",
                guard: "isStarted",
              },
            },
          },
          playing: {
            entry: ["setTime"],
            after: {
              timeout: {
                target: "#cod.result",
              },
            },
            always: [
              {
                target: "#cod.result",
                guard: "isCompleted",
                actions: ["assignWinner"],
              },
            ],
            on: {
              KEYPRESS: {
                actions: ["pressedKey"],
              },
            },
          },
        },
        on: {
          STATUS: {
            actions: ["wsStatus"],
          },
        },
      },
      result: {
        on: {
          RESTART: {
            target: "#cod.game.paused",
            guard: "isHost",
            actions: ["setKeys"],
          },
        },
      },
    },
    on: {
      CONNECTION_FAILURE: {
        target: "#cod.lobby",
      },
    },
  });
