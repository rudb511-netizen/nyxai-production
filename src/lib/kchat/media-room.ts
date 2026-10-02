import { defaultIceServers, type PeerInfo, type RtcPollResponse } from "@/lib/multiplayer";
import { getBearerToken } from "@/lib/auth/client";
import { applySenderBitrate } from "./call-audio";

function rtcHeaders(json = false): HeadersInit {
  const token = getBearerToken();
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** WebRTC mesh with camera/mic tracks, signaled through /api/rtc. */
export class MediaRoom {
  readonly selfId: string;
  readonly room: string;
  private readonly name: string;
  private readonly local: MediaStream;
  private readonly iceServers: RTCIceServer[];
  private readonly peers = new Map<
    string,
    { pc: RTCPeerConnection; info: PeerInfo; makingOffer: boolean }
  >();
  private cursor = 0;
  private fails = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  onPeers?: (peers: PeerInfo[]) => void;
  onRemote?: (peerId: string, stream: MediaStream) => void;
  onGone?: (peerId: string) => void;
  onState?: (state: { reconnecting: boolean; quality: string }) => void;

  constructor(opts: { room: string; name: string; local: MediaStream; iceServers?: RTCIceServer[] }) {
    this.room = opts.room.slice(0, 64);
    this.name = opts.name.slice(0, 64);
    this.local = opts.local;
    this.iceServers = opts.iceServers?.length ? opts.iceServers : defaultIceServers();
    this.selfId = `m${Math.random().toString(36).slice(2, 10)}`;
  }

  async join() {
    try {
      await this.pollOnce();
    } catch {
      /* retry */
    }
    this.schedule();
  }

  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const p of this.peers.values()) p.pc.close();
    this.peers.clear();
    for (const t of this.local.getTracks()) t.stop();
    void fetch("/api/rtc", {
      method: "POST",
      headers: rtcHeaders(true),
      credentials: "include",
      body: JSON.stringify({ op: "leave", room: this.room, peer: this.selfId }),
      keepalive: true,
    }).catch(() => {});
  }

  async replaceTrack(kind: "audio" | "video", track: MediaStreamTrack) {
    const old = this.local.getTracks().find((t) => t.kind === kind);
    if (old && old !== track) {
      this.local.removeTrack(old);
      old.stop();
    }
    if (!this.local.getTracks().includes(track)) this.local.addTrack(track);
    for (const slot of this.peers.values()) {
      const sender = slot.pc.getSenders().find((s) => s.track?.kind === kind);
      if (sender) await sender.replaceTrack(track);
      else slot.pc.addTrack(track, this.local);
    }
  }

  private schedule() {
    if (this.closed) return;
    this.timer = setTimeout(() => void this.poll(), 600);
  }

  private async poll() {
    if (this.closed) return;
    try {
      await this.pollOnce();
      if (this.fails > 0) {
        this.fails = 0;
        this.onState?.({ reconnecting: false, quality: "ok" });
      }
    } catch {
      this.fails += 1;
      this.onState?.({ reconnecting: true, quality: this.fails > 3 ? "poor" : "ok" });
    }
    this.schedule();
  }

  private async pollOnce() {
    const params = new URLSearchParams({
      room: this.room,
      peer: this.selfId,
      name: this.name,
      since: String(this.cursor),
    });
    const res = await fetch(`/api/rtc?${params}`, { headers: rtcHeaders(), credentials: "include" });
    if (!res.ok) throw new Error("signaling failed");
    const body = (await res.json()) as RtcPollResponse;
    const alive = new Set(body.peers.map((p) => p.id));
    for (const p of body.peers) {
      if (p.id === this.selfId) continue;
      if (!this.peers.has(p.id)) this.connect(p.id, p.name, this.selfId > p.id);
    }
    for (const [id, slot] of this.peers) {
      if (!alive.has(id)) {
        slot.pc.close();
        this.peers.delete(id);
        this.onGone?.(id);
      }
    }
    for (const sig of body.signals) {
      this.cursor = Math.max(this.cursor, sig.id);
      await this.onSignal(sig.from, sig.kind, sig.payload);
    }
    this.emit();
  }

  private connect(id: string, name: string, initiator: boolean) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const slot = {
      pc,
      makingOffer: false,
      info: {
        id,
        name,
        connectionState: pc.connectionState,
        candidateType: null,
        rttMs: null,
      } satisfies PeerInfo,
    };
    this.peers.set(id, slot);
    for (const track of this.local.getTracks()) pc.addTrack(track, this.local);
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        void this.signal(id, "ice", e.candidate.toJSON());
      }
    };
    pc.onconnectionstatechange = () => {
      slot.info.connectionState = pc.connectionState;
      this.emit();
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.onState?.({ reconnecting: true, quality: "unstable" });
        try {
          pc.restartIce();
        } catch {
          /* */
        }
      } else if (pc.connectionState === "connected") {
        this.onState?.({ reconnecting: false, quality: "good" });
        const conn = (navigator as Navigator & { connection?: { downlink?: number; effectiveType?: string } }).connection;
        const kbps =
          conn?.downlink && conn.downlink >= 20
            ? 8000
            : conn?.downlink && conn.downlink >= 8
              ? 3500
              : conn?.effectiveType === "3g"
                ? 800
                : 1800;
        void applySenderBitrate(pc, kbps);
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed") {
        try {
          pc.restartIce();
        } catch {
          /* */
        }
      }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.onRemote?.(id, stream);
    };
    pc.onnegotiationneeded = async () => {
      try {
        slot.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) await this.signal(id, "offer", pc.localDescription.toJSON());
      } finally {
        slot.makingOffer = false;
      }
    };
    if (initiator) {
      pc.createDataChannel("ctrl");
    }
  }

  private async onSignal(from: string, kind: string, payload: unknown) {
    let slot = this.peers.get(from);
    if (!slot) {
      this.connect(from, from, false);
      slot = this.peers.get(from);
    }
    if (!slot) return;
    const pc = slot.pc;
    if (kind === "offer") {
      const offerCollision = slot.makingOffer || pc.signalingState !== "stable";
      const polite = this.selfId < from;
      if (offerCollision && !polite) return;
      await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
      await pc.setLocalDescription();
      if (pc.localDescription) await this.signal(from, "answer", pc.localDescription.toJSON());
    } else if (kind === "answer") {
      await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
    } else if (kind === "ice") {
      try {
        await pc.addIceCandidate(payload as RTCIceCandidateInit);
      } catch {
        /* glare */
      }
    }
  }

  private async signal(to: string, kind: "offer" | "answer" | "ice", payload: unknown) {
    await fetch("/api/rtc", {
      method: "POST",
      headers: rtcHeaders(true),
      credentials: "include",
      body: JSON.stringify({ op: "signal", room: this.room, from: this.selfId, to, kind, payload }),
    });
  }

  private emit() {
    this.onPeers?.([...this.peers.values()].map((p) => ({ ...p.info })));
  }
}
