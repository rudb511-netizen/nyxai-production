/** Official NYX sticker pack names. Art is generated in sticker-art.ts. */

export type CatalogPack = {
  id: string;
  title: string;
  category: string;
  description: string;
  names: string[];
  animated?: string[];
};

export const CATALOG_PACKS: CatalogPack[] = [
  {
    id: "pack_reactions",
    title: "Reactions",
    category: "reactions",
    description: "Faces for every mood.",
    names: [
      "Laughing","Crying","Crying Laughing","Shocked","Surprised","Confused","Angry","Sad","Disappointed","Excited",
      "Scared","Embarrassed","Facepalm","Eye Roll","Thinking","Smirking","Blushing","Mind Blown","Speechless","Annoyed",
      "Tired","Sleepy","Dizzy","Confused Again","Disgusted",
    ],
    animated: ["Laughing","Crying Laughing","Mind Blown","Excited"],
  },
  {
    id: "pack_love",
    title: "Love & Romance",
    category: "love",
    description: "Say it without saying it.",
    names: [
      "I Love You","Love You","I Miss You","Kiss","Hug","Heart Eyes","Blushing","Good Morning Love","Good Night Love","Missing You",
      "You Are Special","Forever","Be Mine","You Complete Me","Thinking About You","Sending Love","Romantic Kiss","Couple Hug",
      "Love You Forever","My Heart","You're Cute","You're Beautiful","You're Handsome","I Like You","Date Me?","Come Here",
      "Give Me A Kiss","Stop Making Me Blush",
    ],
  },
  {
    id: "pack_greetings",
    title: "Greetings",
    category: "greetings",
    description: "Hello through goodbye.",
    names: [
      "Hello","Hi","Hey","Good Morning","Good Afternoon","Good Evening","Good Night","Welcome","How Are You?","Long Time No See",
      "Nice To Meet You","Bye","Goodbye","See You Later","See You Soon","Have A Nice Day","Welcome Back",
    ],
  },
  {
    id: "pack_everyday",
    title: "Everyday",
    category: "everyday",
    description: "The replies you actually send.",
    names: [
      "Okay","Alright","Sure","Yes","No","Maybe","Exactly","True","Really?","Why?","Wait","Hold On","Got It","I Understand",
      "No Problem","Of Course","Definitely","Absolutely","Sounds Good","That Works","Fine","Alright Then","Whatever","I See","Makes Sense",
    ],
  },
  {
    id: "pack_funny",
    title: "Funny & Meme",
    category: "funny",
    description: "When words aren't enough.",
    names: [
      "LOL","LMAO","I Can't Breathe","I'm Dead","You're Crazy","What Did I Just See?","Bro...","Seriously?","Ain't No Way","Who Asked?",
      "I'm Done","That's Crazy","Nice Try","You Thought","Caught You","Big Mistake","Bruh","No Way","What?","Huh?","Wait What?",
      "I'm Crying","This Is Funny","You're Funny","Stop It","I Can't","Send Help","Help Me","Oh No","Well Then...",
    ],
    animated: ["LOL","LMAO","I Can't Breathe","I'm Dead"],
  },
  {
    id: "pack_celebration",
    title: "Celebration",
    category: "celebration",
    description: "Wins, birthdays, finally.",
    names: [
      "Congratulations","Happy Birthday","Well Done","You Did It","Success","Winner","Party","Cheers","Celebration","Achievement Unlocked",
      "Proud Of You","Keep Going","Congrats","Great Job","Amazing","You Made It","Victory","Let's Celebrate","Good News","Finally!",
    ],
  },
  {
    id: "pack_apology",
    title: "Apology",
    category: "apology",
    description: "Own it.",
    names: [
      "Sorry","I'm Sorry","My Bad","Forgive Me","Please","I Didn't Mean It","Can We Talk?","Don't Be Angry","It Was A Mistake",
      "Sorry About That","Please Forgive Me","I Messed Up","My Fault","Give Me Another Chance","Peace?",
    ],
  },
  {
    id: "pack_thanks",
    title: "Thank You",
    category: "thanks",
    description: "Gratitude, actually designed.",
    names: [
      "Thank You","Thanks","Thanks A Lot","Thank You So Much","Appreciate You","You're The Best","Much Love","God Bless You",
      "Respect","I Appreciate It","You Helped Me","Thanks For Everything","You're Amazing",
    ],
  },
  {
    id: "pack_agreement",
    title: "Agreement",
    category: "agreement",
    description: "Yes, facts, done.",
    names: [
      "Yes","Exactly","Facts","Correct","Agreed","Definitely","Absolutely","Perfect","Good Idea","That Works","Deal","Approved",
      "I Agree","True","You're Right","Exactly This","Say Less","Done","No Problem","Of Course",
    ],
  },
  {
    id: "pack_disagreement",
    title: "Disagreement",
    category: "disagreement",
    description: "Hard no, gently or not.",
    names: [
      "No","Nope","Not Happening","I Disagree","Wrong","Absolutely Not","Stop","Never","Are You Serious?","Think Again","No Way",
      "That's Wrong","Not Really","I Don't Think So","Hell No","Forget It","Nah",
    ],
  },
  {
    id: "pack_work",
    title: "Work & School",
    category: "work",
    description: "Busy, studying, almost done.",
    names: [
      "Working","Busy","In A Meeting","Studying","Doing Homework","Exam Time","I'm Tired","Deadline","Finished","Almost Done",
      "Send It","Check Your Email","At Work","At School","Doing Assignment","I Need A Break","Back To Work","Class Time","Study Time","Done For Today",
    ],
  },
  {
    id: "pack_food",
    title: "Food & Drinks",
    category: "food",
    description: "I'm hungry. Let's eat.",
    names: [
      "I'm Hungry","Let's Eat","Pizza","Burger","Chicken","Rice","Noodles","Ice Cream","Cake","Coffee","Tea","Juice","Water",
      "Delicious","I'm Full","Food Time","I Need Food","Yummy","So Good","Let's Order Food","Who's Cooking?","Send Food",
    ],
  },
  {
    id: "pack_money",
    title: "Money",
    category: "money",
    description: "Pay me. Payday. Wahala.",
    names: [
      "Pay Me","Send Money","Money Received","I'm Broke","Rich","Payday","Cash","Shopping","Too Expensive","Good Deal",
      "Thank You For The Money","Send Payment","Payment Received","Money Sent","I Need Money","Where's My Money?","No Money",
      "Making Money","Big Money",
    ],
  },
  {
    id: "pack_animals",
    title: "Animals",
    category: "animals",
    description: "Cats, dogs, and chaos.",
    names: [
      "Cats","Dogs","Puppies","Kittens","Bears","Pandas","Monkeys","Rabbits","Foxes","Lions","Tigers","Penguins","Elephants",
      "Giraffes","Koalas","Frogs","Birds","Hamsters","Cute Animals","Funny Animals",
    ],
  },
  {
    id: "pack_gaming",
    title: "Gaming",
    category: "gaming",
    description: "GG. AFK. Let's go.",
    names: [
      "GG","Game Over","Victory","Defeat","Level Up","Let's Play","Noob","Pro","AFK","Respawn","Headshot","Mission Complete",
      "Mission Failed","Winner","Loser","Game On","Ready?","Player One","Boss Fight","Loading","Achievement Unlocked","You Lost",
      "I Won","Let's Go",
    ],
  },
  {
    id: "pack_nigerian",
    title: "Nigerian-style",
    category: "nigerian",
    description: "How far? No wahala.",
    names: [
      "How Far?","Abeg","No Wahala","E Don Do","Na Lie","Omo!","Wetin?","I Dey Come","I Dey Hungry","Make We Go","You Dey Whine Me?",
      "Who Send You?","Leave Am","God Abeg","Na So","Correct","Wahala","I Swear","E Shock Me","See Finish","No Be Me","Abeg O",
      "Omo See This","Na Wa","You No Serious","I No Understand","Make Una Calm Down","E Don Happen","Forget Am","No Stress","Sharp Sharp",
    ],
  },
  {
    id: "pack_flirting",
    title: "Flirting",
    category: "flirting",
    description: "Hey handsome. Come closer.",
    names: [
      "Hey Handsome","Hey Beautiful","You're Cute","I Miss You","Come Here","Give Me A Kiss","Thinking About You","You Look Good",
      "I Like You","Date Me?","You're Mine","Stop Making Me Blush","I'm Watching You","You Look Amazing","Can I Call You?","Miss Me?",
      "You Like Me?","Be Honest","You're Special","Come Closer",
    ],
  },
  {
    id: "pack_status",
    title: "Chat & Status",
    category: "status",
    description: "Online, on my way, give me a minute.",
    names: [
      "Online","Offline","Busy","Sleeping","Call Me","Text Me","Talk Later","I'll Be Back","Wait For Me","Don't Disturb",
      "Send Voice Note","Send Location","Send Picture","Check Your DM","Call Me Back","Text Me Back","I'm Coming","On My Way",
      "Almost There","Give Me A Minute","Wait","I'm Outside","I'm Home",
    ],
  },
  {
    id: "pack_motivational",
    title: "Motivational",
    category: "motivational",
    description: "You got this.",
    names: [
      "You Got This","Keep Going","Never Give Up","Stay Strong","Believe In Yourself","One Step At A Time","Make It Happen",
      "Keep Winning","You're Doing Great","Proud Of You","You Can Do It","Don't Give Up","Keep Fighting","Stay Focused",
      "Trust Yourself","Keep Pushing","Your Time Is Coming","Work Hard","Stay Positive","You're Almost There",
    ],
  },
  {
    id: "pack_romance_sweet",
    title: "Sweet Romance",
    category: "romance",
    description: "You're my person.",
    names: [
      "I Love You","I Miss You","Thinking About You","You're My Person","You're Special","You're Mine","Forever With You",
      "My Heart Is Yours","You Make Me Smile","I Need You","Stay With Me","Come Closer","Hold Me","Kiss Me","Give Me A Hug",
      "Missing Your Touch","Can't Stop Thinking About You","You Have My Heart","Always You",
    ],
  },
  {
    id: "pack_romance_flirty",
    title: "Flirty Romance",
    category: "romance",
    description: "Don't tease me.",
    names: [
      "Hey Gorgeous","Hey Handsome","You Look Good","You're Attractive","Come Here","Come Closer","Kiss Me","Give Me A Kiss",
      "You're Tempting Me","Stop Looking At Me Like That","You're Making Me Blush","I Want You Close","You're Dangerous",
      "I Can't Resist You","You Know What You're Doing","Don't Tease Me","Keep Looking","I'm Thinking About You",
      "You're Driving Me Crazy","One More Kiss",
    ],
  },
  {
    id: "pack_dark_romance",
    title: "Dark Romance",
    category: "dark-romance",
    description: "After dark.",
    names: [
      "Dark Love","Dark Desire","Dangerously Yours","Beautiful Obsession","Can't Stay Away","You're Mine","Only Mine","Stay With Me",
      "Don't Leave Me","Come Closer","Come To Me","I'm Watching You","I Know You Want Me","You're Tempting Me","You're Dangerous",
      "Dangerous Attraction","Forbidden Feelings","Dark Feelings","Secret Desire","Midnight Thoughts","After Dark","Late Night Thoughts",
      "Can't Sleep Without You","You're On My Mind","I'm Addicted To Your Smile","You Have My Attention","You Have My Heart",
      "I Can't Resist You","You're Hard To Forget","Lost In You","Consumed By Love","Obsessed With You","Beautifully Dangerous",
      "Dark Hearts","Dark Chemistry","Forbidden Romance","Secret Love","Hidden Feelings","Midnight Romance","Dangerous Chemistry",
      "Toxic Attraction","Intense Feelings","Love In The Shadows","Whisper My Name","Stay In My Arms","Don't Let Go",
      "Come A Little Closer","Look At Me","Keep Your Eyes On Me","You Know I Want You",
    ],
  },
  {
    id: "pack_dark_reactions",
    title: "Dark Romance Reactions",
    category: "dark-romance",
    description: "Jealous. Come back.",
    names: [
      "Jealous","I'm Watching","Really?","Who Is That?","Don't Make Me Jealous","You're Mine","Come Back","Don't Ignore Me",
      "I Miss You","Where Are You?","Talk To Me","Look At Me","Don't Leave","Stay","Come Here","I'm Waiting","I'm Thinking About You",
      "You're On My Mind","I Can't Forget You","Still Want You",
    ],
  },
  {
    id: "pack_night_romance",
    title: "Night Romance",
    category: "romance",
    description: "Sweet dreams.",
    names: [
      "Good Night, Beautiful","Good Night, Handsome","Sweet Dreams","Dream About Me","Wish You Were Here","Midnight Thoughts",
      "Late Night Call?","Can't Sleep","Thinking About You Tonight","I Miss You Tonight","Come Talk To Me","Stay Up With Me",
      "One More Message","One More Kiss","Goodnight, My Love","See You In My Dreams",
    ],
  },
  {
    id: "pack_couples",
    title: "Romantic Couples",
    category: "romance",
    description: "Two of you.",
    names: [
      "Couple Hug","Couple Holding Hands","Couple Dancing","Couple Looking At Each Other","Couple Under The Moon",
      "Couple Watching The Sunset","Couple On A Date","Romantic Dinner","Love Letter","Giving Flowers","Receiving Flowers",
      "Romantic Gift","Forehead Kiss","Cheek Kiss","Holding Hands","Cuddling","Falling Asleep Together","Walking Together",
      "Missing Each Other","Reunited",
    ],
  },
];
