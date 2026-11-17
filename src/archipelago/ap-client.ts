/**
 * Minimal Archipelago network protocol client.
 *
 * Implements the subset of https://github.com/ArchipelagoMW/Archipelago/blob/main/docs/network%20protocol.md
 * needed by PokeRogue: connection, item reception, location checks/scouts, data package,
 * goal status and chat/print messages. It has no dependency on the game code.
 */

export interface NetworkItem {
  item: number;
  location: number;
  player: number;
  flags: number;
}

export interface NetworkPlayer {
  team: number;
  slot: number;
  alias: string;
  name: string;
}

export interface NetworkSlot {
  name: string;
  game: string;
  type: number;
}

export interface ConnectedPacket {
  cmd: "Connected";
  team: number;
  slot: number;
  players: NetworkPlayer[];
  missing_locations: number[];
  checked_locations: number[];
  slot_data: Record<string, any>;
  slot_info: Record<string, NetworkSlot>;
  hint_points?: number;
}

export interface RoomInfoPacket {
  cmd: "RoomInfo";
  seed_name: string;
  games: string[];
  password: boolean;
  datapackage_checksums?: Record<string, string>;
}

export interface GameDataPackage {
  item_name_to_id: Record<string, number>;
  location_name_to_id: Record<string, number>;
  checksum?: string;
}

export interface JSONMessagePart {
  type?: string;
  text?: string;
  player?: number;
  flags?: number;
}

/** Item classification flags used by NetworkItem.flags */
export enum ItemFlags {
  FILLER = 0,
  PROGRESSION = 1,
  USEFUL = 2,
  TRAP = 4,
}

export enum ClientStatus {
  CLIENT_UNKNOWN = 0,
  CLIENT_CONNECTED = 5,
  CLIENT_READY = 10,
  CLIENT_PLAYING = 20,
  CLIENT_GOAL = 30,
}

export interface ApConnectOptions {
  /** host:port, optionally prefixed by ws:// or wss:// */
  server: string;
  slot: string;
  password?: string;
  game: string;
  /** Archipelago tags, e.g. ["DeathLink"] */
  tags?: string[];
}

export interface ApClientListener {
  onReceivedItems?(index: number, items: NetworkItem[]): void;
  onLocationInfo?(items: NetworkItem[]): void;
  onRoomUpdate?(packet: any): void;
  onPrint?(text: string, packet: any): void;
  onBounced?(packet: any): void;
  onDisconnected?(): void;
  onReconnected?(connected: ConnectedPacket): void;
}

const AP_VERSION = { major: 0, minor: 5, build: 1, class: "Version" };

/** items_handling: 0b111 = receive items from other worlds, our own world and starting inventory */
const ITEMS_HANDLING_ALL = 0b111;

export class ArchipelagoClient {
  private socket: WebSocket | null = null;
  private options: ApConnectOptions | null = null;
  private listeners: ApClientListener[] = [];
  private uuid: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;
  private pendingConnect: { resolve: (p: ConnectedPacket) => void; reject: (e: Error) => void } | null = null;
  private pendingDataPackage: ((data: Record<string, GameDataPackage>) => void) | null = null;

  public roomInfo: RoomInfoPacket | null = null;
  public connected: ConnectedPacket | null = null;
  public dataPackage: Record<string, GameDataPackage> = {};
  private itemIdToName: Record<string, Record<number, string>> = {};
  private locationIdToName: Record<string, Record<number, string>> = {};

  constructor() {
    let uuid: string | null = null;
    try {
      uuid = localStorage.getItem("ap_client_uuid");
      if (!uuid) {
        uuid = (crypto as any)?.randomUUID?.() ?? `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem("ap_client_uuid", uuid!);
      }
    } catch {
      uuid = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    }
    this.uuid = uuid!;
  }

  get isConnected(): boolean {
    return !!this.connected && this.socket?.readyState === WebSocket.OPEN;
  }

  addListener(listener: ApClientListener): void {
    this.listeners.push(listener);
  }

  /**
   * Opens a connection and authenticates the slot.
   * Tries `wss://` first then falls back to `ws://` when no scheme is given.
   */
  async connect(options: ApConnectOptions): Promise<ConnectedPacket> {
    this.disconnect();
    this.options = options;
    this.manualClose = false;

    const urls = ArchipelagoClient.getCandidateUrls(options.server);
    let lastError: Error = new Error("Unable to connect");
    for (const url of urls) {
      try {
        return await this.openAndAuthenticate(url);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Authentication errors are final, only network errors fall through to the next url
        if ((lastError as any).refused) {
          throw lastError;
        }
      }
    }
    throw lastError;
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.connected = null;
  }

  static getCandidateUrls(server: string): string[] {
    let address = server.trim();
    if (/^wss?:\/\//i.test(address)) {
      return [address];
    }
    if (!/:\d+$/.test(address)) {
      address += ":38281";
    }
    // A page served over https cannot open insecure websockets
    if (typeof location !== "undefined" && location.protocol === "https:") {
      return [`wss://${address}`];
    }
    // Local servers are almost always plain ws, remote ones (archipelago.gg...) use wss
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(address);
    return isLocal ? [`ws://${address}`, `wss://${address}`] : [`wss://${address}`, `ws://${address}`];
  }

  private openAndAuthenticate(url: string): Promise<ConnectedPacket> {
    return new Promise<ConnectedPacket>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      this.socket = socket;

      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          this.pendingConnect = null;
          socket.onclose = null;
          try {
            socket.close();
          } catch {
            // ignore
          }
          if (this.socket === socket) {
            this.socket = null;
          }
          reject(err);
        }
      };

      const timeout = setTimeout(() => fail(new Error(`Connection to ${url} timed out`)), 10000);

      this.pendingConnect = {
        resolve: (p: ConnectedPacket) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            this.pendingConnect = null;
            socket.onclose = () => this.handleClose();
            resolve(p);
          }
        },
        reject: (e: Error) => {
          clearTimeout(timeout);
          fail(e);
        },
      };

      socket.onmessage = event => this.handleMessage(event.data);
      socket.onerror = () => {
        clearTimeout(timeout);
        fail(new Error(`Could not reach ${url}`));
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        fail(new Error(`Connection to ${url} closed`));
      };
    });
  }

  private handleClose(): void {
    this.connected = null;
    this.socket = null;
    this.listeners.forEach(l => l.onDisconnected?.());
    if (!this.manualClose && this.options) {
      this.scheduleReconnect(2000);
    }
  }

  private scheduleReconnect(delay: number): void {
    if (this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.manualClose || !this.options) {
        return;
      }
      try {
        const urls = ArchipelagoClient.getCandidateUrls(this.options.server);
        let connected: ConnectedPacket | null = null;
        for (const url of urls) {
          try {
            connected = await this.openAndAuthenticate(url);
            break;
          } catch {
            // try next
          }
        }
        if (connected) {
          this.listeners.forEach(l => l.onReconnected?.(connected!));
        } else {
          this.scheduleReconnect(Math.min(delay * 2, 30000));
        }
      } catch {
        this.scheduleReconnect(Math.min(delay * 2, 30000));
      }
    }, delay);
  }

  private send(packets: any[]): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(packets));
    }
  }

  private handleMessage(raw: string): void {
    let packets: any[];
    try {
      packets = JSON.parse(raw);
    } catch (err) {
      console.error("[AP] Invalid packet", raw, err);
      return;
    }
    for (const packet of packets) {
      try {
        this.handlePacket(packet);
      } catch (err) {
        console.error("[AP] Error while handling packet", packet, err);
      }
    }
  }

  private handlePacket(packet: any): void {
    switch (packet.cmd) {
      case "RoomInfo":
        this.roomInfo = packet as RoomInfoPacket;
        this.sendConnect();
        break;
      case "Connected":
        this.connected = packet as ConnectedPacket;
        this.requestDataPackage(this.roomInfo?.games ?? []).finally(() => {
          this.pendingConnect?.resolve(this.connected!);
        });
        break;
      case "ConnectionRefused": {
        const err = new Error(`Connection refused: ${(packet.errors ?? []).join(", ") || "unknown error"}`);
        (err as any).refused = true;
        this.pendingConnect?.reject(err);
        break;
      }
      case "ReceivedItems":
        this.listeners.forEach(l => l.onReceivedItems?.(packet.index, packet.items as NetworkItem[]));
        break;
      case "LocationInfo":
        this.listeners.forEach(l => l.onLocationInfo?.(packet.locations as NetworkItem[]));
        break;
      case "RoomUpdate":
        if (this.connected) {
          if (packet.checked_locations) {
            this.connected.checked_locations = [
              ...new Set([...this.connected.checked_locations, ...packet.checked_locations]),
            ];
            this.connected.missing_locations = this.connected.missing_locations.filter(
              l => !packet.checked_locations.includes(l),
            );
          }
          if (packet.players) {
            this.connected.players = packet.players;
          }
        }
        this.listeners.forEach(l => l.onRoomUpdate?.(packet));
        break;
      case "DataPackage":
        this.storeDataPackage(packet.data?.games ?? {});
        this.pendingDataPackage?.(packet.data?.games ?? {});
        this.pendingDataPackage = null;
        break;
      case "PrintJSON":
        this.listeners.forEach(l => l.onPrint?.(this.renderJsonMessage(packet.data ?? []), packet));
        break;
      case "Bounced":
        this.listeners.forEach(l => l.onBounced?.(packet));
        break;
      case "InvalidPacket":
        console.warn("[AP] Invalid packet reported by server", packet);
        break;
    }
  }

  private sendConnect(): void {
    if (!this.options) {
      return;
    }
    this.send([
      {
        cmd: "Connect",
        password: this.options.password ?? "",
        game: this.options.game,
        name: this.options.slot,
        uuid: this.uuid,
        version: AP_VERSION,
        items_handling: ITEMS_HANDLING_ALL,
        tags: this.options.tags ?? [],
        slot_data: true,
      },
    ]);
  }

  private requestDataPackage(games: string[]): Promise<void> {
    const missing = games.filter(g => !this.dataPackage[g]);
    if (missing.length === 0) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingDataPackage = null;
        resolve();
      }, 10000);
      this.pendingDataPackage = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.send([{ cmd: "GetDataPackage", games: missing }]);
    });
  }

  private storeDataPackage(games: Record<string, GameDataPackage>): void {
    for (const [game, data] of Object.entries(games)) {
      this.dataPackage[game] = data;
      this.itemIdToName[game] = Object.fromEntries(
        Object.entries(data.item_name_to_id ?? {}).map(([name, id]) => [id, name]),
      );
      this.locationIdToName[game] = Object.fromEntries(
        Object.entries(data.location_name_to_id ?? {}).map(([name, id]) => [id, name]),
      );
    }
  }

  /* ---------------------------------------------------------------- Helpers */

  getPlayerName(slot: number): string {
    if (slot === 0) {
      return "Archipelago";
    }
    const player = this.connected?.players.find(p => p.slot === slot);
    return player?.alias || player?.name || `Player ${slot}`;
  }

  getPlayerGame(slot: number): string | undefined {
    return this.connected?.slot_info?.[slot]?.game;
  }

  getItemName(itemId: number, receivingSlot: number): string {
    const game = this.getPlayerGame(receivingSlot);
    return (game && this.itemIdToName[game]?.[itemId]) || `Item ${itemId}`;
  }

  getLocationName(locationId: number, slot: number): string {
    const game = this.getPlayerGame(slot);
    return (game && this.locationIdToName[game]?.[locationId]) || `Location ${locationId}`;
  }

  private renderJsonMessage(parts: JSONMessagePart[]): string {
    return parts
      .map(part => {
        switch (part.type) {
          case "player_id":
            return this.getPlayerName(Number(part.text));
          case "item_id":
            return this.getItemName(Number(part.text), part.player ?? 0);
          case "location_id":
            return this.getLocationName(Number(part.text), part.player ?? 0);
          default:
            return part.text ?? "";
        }
      })
      .join("");
  }

  /* --------------------------------------------------------------- Commands */

  checkLocations(locations: number[]): void {
    if (locations.length > 0) {
      this.send([{ cmd: "LocationChecks", locations }]);
    }
  }

  scoutLocations(locations: number[], createAsHint = 0): void {
    if (locations.length > 0) {
      this.send([{ cmd: "LocationScouts", locations, create_as_hint: createAsHint }]);
    }
  }

  setStatus(status: ClientStatus): void {
    this.send([{ cmd: "StatusUpdate", status }]);
  }

  requestSync(): void {
    this.send([{ cmd: "Sync" }]);
  }

  say(text: string): void {
    this.send([{ cmd: "Say", text }]);
  }

  bounce(data: any, tags: string[]): void {
    this.send([{ cmd: "Bounce", tags, data }]);
  }
}
