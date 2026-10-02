# NYX

NYX is a mobile-first social network: accounts, profiles, friends, follows, a home feed, 24-hour stories, disappearing Flashes, streaks, short video, live rooms, voice/video calls, Atlas (friends map), Memories, communities, and NYXAI — a free built-in guide.

This workspace ships as an **installable web app (PWA)**. Native Android/iOS store binaries are not produced here — install to the home screen from the browser for the closest native feel.

## What to try

1. Create an account with email and password. Username, display name, Male or Female, and date of birth are required.
2. You can also continue with Google or X.
3. Finish your profile, then open Discover to find people. Follow, add friends, or block.
4. Post text, photos, video, GIFs, or a poll. Add a 24-hour story from Capture or Create.
5. Message a friend — streaks count when both sides reply inside the window. Freeze/recover lives in the thread.
6. Capture a Flash (photo or short video). Send it to friends — they open it once. Keep it in Memories, or add it to Story / Watch.
7. Open Atlas for the friends map. Ghost mode is on by default.
8. Watch short videos, start a live room, or place a call (camera and microphone permission required).
9. Ask NYXAI anything about the app, or tell it to draft a post. It’s free and always on.
10. The first finished profile is super-admin. Settings → Moderation reviews reports.

## Honest limits

- **Not a store app.** NYX runs in the browser and as a PWA. There is no Play Store / App Store binary from this project.
- **Live and calls** use WebRTC between the people in the room. That is real camera/mic, not a fake player — and it is a small-room mesh, not a CDN broadcast to millions.
- **Media** is compressed and stored with the app database. Production at large scale should move blobs to object storage and a CDN.
- **Email verification and password reset** send real mail through Gmail SMTP from `NYX Support <nyx.officialsupport@gmail.com>` (`smtp.gmail.com:587` STARTTLS). Production must provide the existing `SMTP_PASS` deployment secret — the password is never stored in source, logs, or the database. Sign-in still works with email/password, Google, and X.
- **Push notifications** in the PWA follow the browser; full native push needs a store build plus a push service.
- **NYXAI** is a built-in product guide (how Flashes, streaks, Atlas, and the rest work, plus drafting copy). It does not call a paid model.

## Appearance

Dark by default, with a light theme and system follow in Settings. Coral capture, cyan Atlas, amber streaks, violet NYXAI on plum ink — original NYX marks, not a clone of another network.
