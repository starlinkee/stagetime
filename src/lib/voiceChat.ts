/**
 * Proximity voice chat: push-to-talk (hold Z, see RoomStage.tsx), mesh WebRTC between peers in
 * the same room, volume scaled by on-screen distance. Signaling (SDP offer/answer + trickled ICE
 * candidates) is relayed through realtime-server's own WebSocket via the "voiceSignal"
 * ClientMessage/ServerMessage (see @realtime-shared/types) — the actual audio never touches that
 * server, it flows directly peer-to-peer once negotiated.
 *
 * A plain class, not a hook: it needs to survive independent of render and be driven from
 * RoomStage.tsx's own tick loop (60fps position updates) and WS message handler, same reasoning
 * as `ws`/`othersRef` living in refs there rather than React state.
 */

/** Silent beyond this distance (px, box-center to box-center) — the screen is 1366x768 and the
 * camera centers on the local player, so this keeps "audible" roughly within what's on screen. */
const VOICE_MAX_RANGE = 700;
/** Opens a peer connection a bit before it's actually audible, so there's no pop/lag right as
 * someone walks into range. */
const VOICE_CONNECT_RANGE = 900;
/** Wider than VOICE_CONNECT_RANGE on purpose: hysteresis so a peer hovering near the connect
 * threshold doesn't open/close a peer connection every tick. */
const VOICE_DISCONNECT_RANGE = 1100;

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

interface Peer {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  senderTrack: RTCRtpSender | null;
}

export class VoiceChat {
  private readonly myId: string;
  private readonly sendSignal: (to: string, data: unknown) => void;
  private micStream: MediaStream | null = null;
  private micRequestFailed = false;
  private transmitting = false;
  private readonly peers = new Map<string, Peer>();
  private destroyed = false;

  constructor(myId: string, sendSignal: (to: string, data: unknown) => void) {
    this.myId = myId;
    this.sendSignal = sendSignal;
  }

  /** Lazily requests the mic on the first-ever call with `on: true` — a player who never holds Z
   * never gets a permission prompt. */
  setTransmitting(on: boolean): void {
    if (this.destroyed) return;
    this.transmitting = on;
    if (on && !this.micStream && !this.micRequestFailed) {
      void this.requestMic();
      return;
    }
    this.applyTransmitting();
  }

  private async requestMic(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.destroyed) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.micStream = stream;
      // Muted by default even once granted — applyTransmitting() below only enables the track
      // while `transmitting` is actually true right now (Z may already have been released).
      for (const track of stream.getTracks()) track.enabled = false;
      for (const peer of this.peers.values()) this.attachMicTrack(peer);
      this.applyTransmitting();
    } catch (err) {
      this.micRequestFailed = true;
      console.warn("voiceChat: mic permission denied or unavailable", err);
    }
  }

  private applyTransmitting(): void {
    if (!this.micStream) return;
    for (const track of this.micStream.getTracks()) track.enabled = this.transmitting;
  }

  private attachMicTrack(peer: Peer): void {
    if (!this.micStream || peer.senderTrack) return;
    const track = this.micStream.getAudioTracks()[0];
    if (!track) return;
    peer.senderTrack = peer.pc.addTrack(track, this.micStream);
  }

  /** Call every tick with the current set of connection ids in this room (see othersRef.current
   * in RoomStage.tsx) — opens/closes peer connections as people arrive, leave, or drift past
   * VOICE_DISCONNECT_RANGE. Distances come from the same call site as updateProximity, so this is
   * a no-op unless idsInRoom actually changed shape. */
  syncPeers(idsInRoom: readonly string[], distances: ReadonlyMap<string, number>): void {
    if (this.destroyed) return;
    const idSet = new Set(idsInRoom);
    for (const id of idSet) {
      if (id === this.myId || this.peers.has(id)) continue;
      const dist = distances.get(id);
      if (dist !== undefined && dist <= VOICE_CONNECT_RANGE) this.connectTo(id);
    }
    for (const [id, peer] of this.peers) {
      const dist = distances.get(id);
      const stillNearby = dist !== undefined && dist <= VOICE_DISCONNECT_RANGE;
      if (!idSet.has(id) || !stillNearby) this.closePeer(id, peer);
    }
  }

  /** Call every tick with everyone's current position (box top-left, matches PlayerState.x/y) —
   * sets each connected peer's playback volume from distance, and hands back the same distances
   * for syncPeers above to reuse instead of recomputing. */
  updateProximity(
    mePos: { x: number; y: number },
    others: Readonly<Record<string, { x: number; y: number }>>,
  ): ReadonlyMap<string, number> {
    const distances = new Map<string, number>();
    for (const [id, pos] of Object.entries(others)) {
      const dist = Math.hypot(pos.x - mePos.x, pos.y - mePos.y);
      distances.set(id, dist);
      const peer = this.peers.get(id);
      if (peer) peer.audioEl.volume = Math.max(0, Math.min(1, 1 - dist / VOICE_MAX_RANGE));
    }
    return distances;
  }

  private connectTo(id: string): void {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audioEl = new Audio();
    audioEl.autoplay = true;
    // Not attached to the DOM — playback works from a detached element as long as autoplay is
    // allowed, which it is here (the user already interacted with the page long before any peer
    // audio arrives).
    const peer: Peer = { pc, audioEl, senderTrack: null };
    this.peers.set(id, peer);
    this.attachMicTrack(peer);

    pc.ontrack = (ev) => {
      audioEl.srcObject = ev.streams[0] ?? null;
      void audioEl.play().catch((err) => console.warn("voiceChat: audio playback blocked", err));
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.sendSignal(id, { kind: "ice", candidate: ev.candidate.toJSON() });
    };

    // Deterministic offerer: whichever id sorts lower always offers, the other only answers —
    // avoids both sides racing to send an offer at once (signaling glare).
    if (this.myId < id) {
      void (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(id, { kind: "sdp", description: pc.localDescription });
      })();
    }
  }

  /** Call from RoomStage.tsx's own WS message handler on a "voiceSignal" ServerMessage. */
  handleSignal(from: string, data: unknown): void {
    if (this.destroyed) return;
    const payload = data as { kind?: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    let peer = this.peers.get(from);
    if (!peer) {
      // An offer from a peer we haven't opened a connection to yet (e.g. they came into range
      // from their side a tick before we did) — accept it the same way connectTo() would.
      if (payload.kind !== "sdp" || !payload.description || payload.description.type !== "offer") return;
      this.connectTo(from);
      peer = this.peers.get(from);
      if (!peer) return;
    }
    if (payload.kind === "sdp" && payload.description) {
      void (async () => {
        await peer!.pc.setRemoteDescription(payload.description!);
        if (payload.description!.type === "offer") {
          const answer = await peer!.pc.createAnswer();
          await peer!.pc.setLocalDescription(answer);
          this.sendSignal(from, { kind: "sdp", description: peer!.pc.localDescription });
        }
      })();
    } else if (payload.kind === "ice" && payload.candidate) {
      void peer.pc.addIceCandidate(payload.candidate).catch(() => {});
    }
  }

  private closePeer(id: string, peer: Peer): void {
    peer.pc.close();
    peer.audioEl.srcObject = null;
    this.peers.delete(id);
  }

  destroy(): void {
    this.destroyed = true;
    for (const [id, peer] of this.peers) this.closePeer(id, peer);
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
  }
}
