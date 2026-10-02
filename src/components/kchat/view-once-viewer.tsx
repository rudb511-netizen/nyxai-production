import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { setSecureFlag } from "@/utils/nativeCapabilities";

function setNativeSecureFlag(on: boolean) {
  void setSecureFlag(on);
}

/** Full-screen one-time viewer. No download, share, save, or forward. */
export function ViewOnceViewer({
  url,
  kind,
  onClose,
}: {
  url: string;
  kind: string;
  onClose: () => void;
}) {
  const closed = useRef(false);
  function close() {
    if (closed.current) return;
    closed.current = true;
    setNativeSecureFlag(false);
    onClose();
  }

  useEffect(() => {
    setNativeSecureFlag(true);
    const onHide = () => {
      if (document.visibilityState === "hidden") close();
    };
    const block = (e: Event) => e.preventDefault();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "PrintScreen" || (e.key === "s" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        close();
      }
      if (e.key === "Escape") close();
    };
    document.addEventListener("visibilitychange", onHide);
    document.addEventListener("contextmenu", block);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    document.documentElement.classList.add("kc-media-open");
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.documentElement.classList.remove("kc-media-open");
      setNativeSecureFlag(false);
      document.removeEventListener("visibilitychange", onHide);
      document.removeEventListener("contextmenu", block);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      document.body.style.userSelect = prev;
    };
  }, []);

  const voice = kind === "voice" || url.startsWith("data:audio") || url.startsWith("blob:") && kind === "voice";
  const video = kind === "video" || url.startsWith("data:video");

  return (
    <div
      className="kc-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="View once"
      data-nyx-overlay="media"
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        className="kc-lightbox-close"
        aria-label="Close"
        onClick={close}
      >
        <X className="size-5" />
      </button>
      <div className="kc-lightbox-stage">
        {voice ? (
          <audio
            src={url}
            controls
            autoPlay
            controlsList="nodownload noplaybackrate"
            className="w-[min(100%,24rem)] px-6"
            onEnded={close}
          />
        ) : video ? (
          <video
            src={url}
            autoPlay
            playsInline
            controls
            controlsList="nodownload noremoteplayback noplaybackrate"
            disablePictureInPicture
            className="kc-lightbox-media"
            onEnded={close}
          />
        ) : (
          <img src={url} alt="" draggable={false} className="kc-lightbox-media" />
        )}
      </div>
      <p className="kc-lightbox-actions is-on text-center text-[11px] text-muted">
        One viewing. No save, share, or replay. This browser cannot block screenshots. On NYX Android the viewer uses a
        secure window. NYX cannot stop a photo of the screen.
      </p>
    </div>
  );
}
