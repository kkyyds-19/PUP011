import {
    _decorator, Button, Color, Component, EventTouch, game, instantiate,
    Graphics, Label, Node, ParticleSystem, ProgressBar, sp, Sprite, SpriteFrame, Tween, UIOpacity, UITransform, Vec3, tween,
} from 'cc';
import { PlayableVariantKit } from '../../PlayableVariantKit/PlayableVariantKit';
import { EndCardVideo } from './EndCardVideo';
import { GameAudio } from './GameAudio';
import { IntroVideo } from './IntroVideo';
import { LanguageConfig } from './LanguageConfig';

const { ccclass, property } = _decorator;

const WORDS = [
    // 原有词表（顺序即关卡顺序，请勿随意调整）
    'HEART', 'BEAR', 'ART', 'BAT', 'BATH', 'EARTH', 'EAT', 'BEAT', 'BATHE',
    'HAT', 'HEAT', 'THERE', 'TEA', 'HATE', 'THREE',
    'BARE', 'HATER', 'BEER', 'BERET', 'BEET', 'BERTH', 'HEAR', 'EATER', 'TEAR', 'ETHER',
    // 补充：3 字母
    'ARE', 'ATE', 'BAH', 'BAR', 'BEE', 'BET', 'BRA', 'EAR', 'ERA', 'ETA',
    'HER', 'RAH', 'RAT', 'TAB', 'TAR', 'TEE', 'THE',
    // 补充：4 字母
    'ABET', 'BATE', 'BETA', 'BRAT', 'BRAE', 'HARE', 'HART', 'HERB',
    'HERE', 'RATE', 'RHEA', 'TARE', 'THEE', 'TREE',
    // 补充：5 字母
    'BATHER', 'BEATER', 'HEATER', 'ARETE',
];
// 标题显示与通关进度仍按原来的 25 关，超出的词只作为额外的可拼答案。
const TOTAL_WORDS = 25;
const HINT_DELAY = 3;
const HINT_FADE_PERIOD = 1.6;
const CONFETTI_DURATION = 1;
const WRONG_FEEDBACK_DURATION = 0.5;
const WRONG_ANSWER_PENALTY_MS = 5_000;
const WRONG_REACTION_MIX = 0.15;
const NUMBER_GAP = 6;
const ROW_PADDING = 12;

@ccclass('GameManager')
export class GameManager extends Component {
    @property({ range: [1, 600], tooltip: '倒计时总时长（秒），首次点击后开始计时；进度条按剩余时间占此时长的比例刷新。' })
    private roundDuration = 60;

    @property({ type: ProgressBar, tooltip: '拖入显示剩余时间的 ProgressBar 组件。' })
    private countdownBar: ProgressBar | null = null;

    @property({ type: GameAudio, tooltip: '绑定负责播放选字和判题音效的 GameAudio 组件。' })
    private audio: GameAudio | null = null;

    @property({ type: LanguageConfig, tooltip: '绑定负责刷新标题和剩余词数的 LanguageConfig 组件。' })
    private title: LanguageConfig | null = null;

    @property({ type: Node, tooltip: '拖入包含字母按钮的圆盘节点，用于接收连字手势。' })
    private wheel: Node | null = null;

    @property({ type: [Button], tooltip: '按下方字母顺序绑定七个字母按钮，两个 E 分开绑定。' })
    private buttons: Button[] = [];

    @property({ tooltip: '按按钮数组顺序填写七个大写字母，每个按钮对应一个字符，例如 HETABER。' })
    private buttonLetters = 'HETABER';

    @property({ type: Node, tooltip: '拖入包含题号和全部填字槽的输入区节点。' })
    private row: Node | null = null;

    @property({ type: Label, tooltip: '绑定白色横线左侧显示当前题号的 Label。' })
    private roundNumber: Label | null = null;

    @property({ type: [Sprite], tooltip: '从左到右绑定五个横线上方显示字母的 Sprite。' })
    private slotSprites: Sprite[] = [];

    @property({ type: UITransform, tooltip: '绑定第一个槽的横线 UITransform，用于计算整排宽度和题号位置。' })
    private firstUnderline: UITransform | null = null;

    @property({ type: Node, tooltip: '绑定答错时短暂显示并淡出的红色背景节点。' })
    private wrongBackground: Node | null = null;

    @property({ type: Node, tooltip: '绑定礼花节点，答对时播放其子节点上的粒子特效。' })
    private confettiRoot: Node | null = null;

    @property({ type: sp.Skeleton, tooltip: '绑定猫咪节点下的 Spine 骨骼动画组件，用于播放答题反馈。' })
    private catSpine: sp.Skeleton | null = null;

    @property({ type: EndCardVideo, tooltip: '绑定胜负结算动画播完后播放落版视频的组件。' })
    private endCard: EndCardVideo | null = null;

    @property({ type: Node, tooltip: '绑定包含胜利和失败 Label 的落版节点。' })
    private resultNode: Node | null = null;

    @property({ type: Node, tooltip: '绑定落版节点下的 SpriteSplash 背景，结算时先于胜负文字渐显。' })
    private splash: Node | null = null;

    @property({ type: Label, tooltip: '绑定在时限内完成全部单词后显示的胜利 Label。' })
    private victoryLabel: Label | null = null;

    @property({ type: Label, tooltip: '绑定倒计时结束仍有单词未完成时显示的失败 Label。' })
    private defeatLabel: Label | null = null;

    @property({ type: IntroVideo, tooltip: '绑定负责点击播放开场视频并在播完后交回游戏控制的组件。' })
    private intro: IntroVideo | null = null;

    @property({ type: Button, tooltip: '绑定开场视频结束后弹出、点击后才开始拼字的开局按钮。' })
    private startButton: Button | null = null;

    @property({ type: Node, tooltip: '绑定进入游戏后指向首个提示字母的 PUP 指引手节点。' })
    private letterGuide: Node | null = null;

    private readonly selectedButtons: Button[] = [];
    private readonly foundWords = new Set<string>();
    private readonly activeTouches = new Set<number>();
    private readonly letterPops = new Map<Node, { scale: Vec3; animation: Tween<Node> }>();
    private slotOpacities: UIOpacity[] = [];
    private countdownDeadline: number | null = null;
    private introPending = false;
    private awaitingStart = false;
    private startConfirmed = false;
    private startButtonTween: Tween<Node> | null = null;
    private startGuide: { node: Node; animation: Tween<Node> } | null = null;
    private finished = false;
    private endCardState: 'result' | 'playing' | 'complete' | null = null;
    private resultTween: Tween<{ opacity: number; scale: number }> | null = null;
    private splashTween: Tween<UIOpacity> | null = null;
    private lastStoreEvent: EventTouch | null = null;
    private rowPosition: Vec3;
    private trail: Graphics;
    private confettiParticles: ParticleSystem[] = [];
    private wrongBackgroundOpacity: UIOpacity | null = null;
    private wrongFeedbackTween: Tween<UIOpacity> | null = null;
    private hintTween: Tween<{ opacity: number }> | null = null;
    private confettiTween: Tween<Node> | null = null;
    private letterGuideTween: Tween<Node> | null = null;
    private locked = true;
    private idleTime = 0;
    private gesture: { id: number; first: Button; dragging: boolean } | null = null;
    private handledEnd: EventTouch | null = null;

    // 初始化游戏界面，隐藏结算和开局按钮并准备开场视频。
    protected start(): void {
        if (this.resultNode) this.resultNode.active = false;
        if (this.splash) this.splash.active = false;
        if (this.startButton) this.startButton.node.active = false;
        if (this.confettiRoot) {
            this.confettiRoot.active = false;
            this.confettiParticles = this.confettiRoot.getComponentsInChildren(ParticleSystem);
            for (const particle of this.confettiParticles) {
                particle.playOnAwake = false;
            }
        }
        if (this.countdownBar) {
            this.countdownBar.progress = 1;
        }
        this.title?.setRemainingWords(TOTAL_WORDS);
        if (!this.wheel || !this.row || !this.firstUnderline) {
            console.error('GameManager 请绑定字母圆盘、输入区和首格横线。');
            return;
        }
        if (this.buttons.length !== 7 || this.buttons.some(button => !button) || !/^[A-Z]{7}$/.test(this.buttonLetters)) {
            console.error('GameManager 请按顺序绑定七个字母按钮和对应的大写字母。');
            return;
        }
        if (this.slotSprites.length !== 5 || this.slotSprites.some(slot => !slot)) {
            console.error('GameManager 请从左到右绑定五个输入字母的 Sprite。');
            return;
        }
        for (const button of this.buttons) {
            // 让字母缩放统一由选中动画驱动，避免与 Button 自带的缩放过渡叠加。
            if (button.transition === Button.Transition.SCALE) {
                button.transition = Button.Transition.NONE;
            }
        }
        this.slotOpacities = this.slotSprites.map(slot =>
            slot.getComponent(UIOpacity) ?? slot.addComponent(UIOpacity),
        );
        if (this.wrongBackground) {
            this.wrongBackgroundOpacity = this.wrongBackground.getComponent(UIOpacity)
                ?? this.wrongBackground.addComponent(UIOpacity);
            this.wrongBackground.active = false;
        }

        this.rowPosition = this.row.position.clone();
        this.trail = this.createGraphics(this.wheel, '字母连线');
        this.trail.node.setSiblingIndex(0);
        this.wheel.on(Node.EventType.TOUCH_START, this.onWheelStart, this, true);
        this.wheel.on(Node.EventType.TOUCH_MOVE, this.onWheelMove, this, true);
        this.wheel.on(Node.EventType.TOUCH_END, this.onWheelEnd, this, true);
        this.wheel.on(Node.EventType.TOUCH_CANCEL, this.onWheelEnd, this, true);
        this.node.on(Node.EventType.TOUCH_START, this.onPlayerTouch, this, true);
        this.node.on(Node.EventType.TOUCH_END, this.onPlayerTouch, this, true);
        this.node.on(Node.EventType.TOUCH_CANCEL, this.onPlayerTouch, this, true);
        this.showRound();
        const videoReady = this.intro?.prepare(
            () => this.audio?.unlockAudio(),
            this.onIntroComplete.bind(this),
            this.startButton ? this.showStartButton.bind(this) : null,
        ) ?? false;
        this.introPending = videoReady || !!this.startButton;
        this.audio?.setIntroPending(this.introPending);
        this.locked = this.introPending;
        if (!videoReady && this.startButton) this.onIntroComplete(false);
    }

    // 清理触摸监听、开局按钮、指引手、结算 Tween 和判题反馈。
    protected onDestroy(): void {
        this.node.targetOff(this);
        this.wheel?.targetOff(this);
        if (this.row) {
            Tween.stopAllByTarget(this.row);
        }
        this.hintTween?.stop();
        this.startButtonTween?.stop();
        this.hideStartGuide();
        this.resultTween?.stop();
        this.splashTween?.stop();
        this.hideLetterGuide();
        this.stopConfetti();
        this.wrongFeedbackTween?.stop();
        if (this.wrongBackground?.isValid) {
            this.wrongBackground.active = false;
        }
        for (const node of this.letterPops.keys()) {
            this.stopLetterPop(node);
        }
    }

    // 刷新倒计时，并在玩家停手三秒后启动提示动画。
    protected update(deltaTime: number): void {
        this.updateCountdown();
        if (this.locked || this.activeTouches.size > 0 || this.hintTween) {
            return;
        }

        this.idleTime += deltaTime;
        if (this.idleTime >= HINT_DELAY) {
            this.showHint();
        }
    }

    // 开场结束后开始游戏计时，落版播完后点击屏幕打开商店。
    private onPlayerTouch(event: EventTouch): void {
        if (this.introPending) return;
        if (event.type === Node.EventType.TOUCH_START) {
            if (this.countdownDeadline === null && !this.finished) {
                this.beginRound();
            }
            this.activeTouches.add(event.getID());
        } else {
            this.activeTouches.delete(event.getID());
        }
        this.clearHint();
        if (this.endCardState === 'complete' && event.type === Node.EventType.TOUCH_END) {
            this.openStore(event);
        }
    }

    // 开场淡出后解锁游戏，视频不可用时先保留开局按钮流程。
    private onIntroComplete(requested: boolean): void {
        if (this.startButton && !this.startConfirmed) {
            this.showStartButton();
            return;
        }
        this.introPending = false;
        this.audio?.setIntroPending(false);
        this.locked = false;
        if (requested || this.startConfirmed) {
            this.beginRound();
            this.showLetterGuide();
        }
    }

    // 在开场最后一帧上方弹出开局按钮，并在按钮上显示指引手。
    private showStartButton(): void {
        const button = this.startButton;
        if (!button || this.awaitingStart) return;
        this.awaitingStart = true;
        const node = button.node;
        const scale = node.scale.clone();
        if (button.transition === Button.Transition.SCALE) button.transition = Button.Transition.NONE;
        node.setSiblingIndex(node.parent.children.length - 1);
        node.setScale(scale.x * 0.35, scale.y * 0.35, scale.z);
        node.active = true;
        this.startButtonTween = tween(node)
            .to(0.5, { scale }, { easing: 'backOut' })
            .start();
        if (this.letterGuide) {
            const hand = instantiate(this.letterGuide);
            hand.name = '开局指引手';
            hand.setParent(node);
            hand.setPosition(38, -12, 0);
            hand.setScale(0.72, 0.72, 1);
            this.startGuide = { node: hand, animation: this.pulseGuide(hand) };
        }
    }

    // 确认开局并收起按钮和指引手，等视频淡出后再进入游戏。
    public startFromButton(): void {
        if (!this.awaitingStart) return;
        this.awaitingStart = false;
        this.startConfirmed = true;
        this.startButtonTween?.stop();
        this.startButtonTween = null;
        this.hideStartGuide();
        if (this.startButton) this.startButton.node.active = false;
        this.audio?.unlockAudio();
        if (!this.intro?.dismissLastFrame()) this.onIntroComplete(true);
    }

    // 停止开局指引手动画并移除临时节点。
    private hideStartGuide(): void {
        const guide = this.startGuide;
        if (!guide) return;
        guide.animation.stop();
        guide.node.active = false;
        guide.node.destroy();
        this.startGuide = null;
    }

    // 显示首个提示字母的指引手并开始循环缩放。
    private showLetterGuide(): void {
        const hand = this.letterGuide;
        if (!hand || this.letterGuideTween) return;

        this.letterGuideTween = this.pulseGuide(hand);
    }

    // 让指引手围绕指尖循环缩放，模拟点按。
    private pulseGuide(hand: Node): Tween<Node> {
        const scale = hand.scale.clone();
        const pressed = new Vec3(scale.x * 0.86, scale.y * 0.86, scale.z);
        hand.active = true;
        return tween(hand)
            .repeatForever(tween(hand)
                .to(0.45, { scale: pressed }, { easing: 'sineInOut' })
                .to(0.45, { scale }, { easing: 'sineInOut' }))
            .start();
    }

    // 停止缩放并隐藏场景里的 PUP 指引手。
    private hideLetterGuide(): void {
        this.letterGuideTween?.stop();
        this.letterGuideTween = null;
        if (this.letterGuide?.isValid) this.letterGuide.active = false;
    }

    // 同时启动游戏倒计时和试玩广告版本的游戏会话。
    private beginRound(): void {
        this.countdownDeadline = game.totalTime + this.roundDuration * 1000;
        PlayableVariantKit.instance?.gameStart();
    }

    // 响应按钮点击，并在结算和落版视频期间暂缓商店跳转。
    public openStore(event?: EventTouch): void {
        if (this.introPending || this.endCardState === 'result' || this.endCardState === 'playing'
            || (event && event === this.lastStoreEvent)) {
            return;
        }
        this.lastStoreEvent = event ?? null;
        PlayableVariantKit.instance?.openStore(true);
    }

    // 按剩余时间刷新进度条，归零时进入失败结算。
    private updateCountdown(): void {
        if (this.countdownDeadline === null || this.finished) {
            return;
        }
        const remaining = Math.max(0, this.countdownDeadline - game.totalTime);
        if (this.countdownBar) {
            this.countdownBar.progress = remaining / (this.roundDuration * 1000);
        }
        if (remaining === 0) {
            this.finishGame(false);
        }
    }

    // 视频播完或无法播放时自动跳转一次，之后开放全屏点击跳转。
    private onEndCardComplete(): void {
        if (this.endCardState === 'playing') {
            this.endCardState = 'complete';
            PlayableVariantKit.instance?.redirectOnCountdownEnd();
        }
    }

    // 锁定本局输入，失败时播放音效，再显示对应的结算动画。
    private finishGame(won: boolean): void {
        if (this.finished) return;
        this.finished = true;
        this.locked = true;
        this.endCardState = 'result';
        PlayableVariantKit.instance?.suspendAutomaticRedirects();
        this.gesture = null;
        this.hideLetterGuide();
        this.clearHint();
        this.trail.clear();
        for (const button of this.buttons) {
            button.interactable = false;
        }
        if (!won) this.audio?.playDefeat();
        this.showResult(won);
    }

    // 落版背景 SpriteSplash 先渐显 0.3 秒并保持，随后胜负文字用 0.2 秒渐显。
    private showResult(won: boolean): void {
        const animationDuration = won ? 0 : this.playDefeatAnimation();
        const root = this.resultNode;
        const label = won ? this.victoryLabel : this.defeatLabel;
        if (!root || !label) {
            this.scheduleOnce(this.playEndCard, animationDuration);
            return;
        }
        if (this.victoryLabel) this.victoryLabel.node.active = won;
        if (this.defeatLabel) this.defeatLabel.node.active = !won;
        root.setSiblingIndex(root.parent.children.length - 1);
        // 落版节点作为容器整体显示，透明度交给背景和文字分别控制。
        const rootOpacity = root.getComponent(UIOpacity);
        if (rootOpacity) rootOpacity.opacity = 255;
        root.active = true;

        // 胜利/失败节点单独做缩放和渐显，避免连带动画落版背景。
        const text = label.node;
        const textOpacity = text.getComponent(UIOpacity) ?? text.addComponent(UIOpacity);
        const baseScale = text.scale.clone();
        const pose = { opacity: 0, scale: 0.8 };
        const applyPose = (): void => {
            textOpacity.opacity = pose.opacity;
            text.setScale(baseScale.x * pose.scale, baseScale.y * pose.scale, baseScale.z);
        };
        applyPose();

        const splash = this.splash;
        // 文字用 0.2 秒渐显并保持，显示完成后接落版视频。
        const showText = (): void => {
            this.resultTween = tween(pose)
                .to(0.2, { opacity: 255, scale: 1 }, { easing: 'quadOut', onUpdate: applyPose })
                .call(() => {
                    this.resultTween = null;
                    // 失败时等猫动画播完再进入落版视频。
                    this.scheduleOnce(this.playEndCard, Math.max(1, animationDuration - 0.5));
                })
                .start();
        };

        if (!splash) {
            showText();
            return;
        }
        // 落版背景 SpriteSplash 用 0.3 秒渐显，显示后立即弹出胜负文字且不淡出。
        splash.active = true;
        const splashOpacity = splash.getComponent(UIOpacity) ?? splash.addComponent(UIOpacity);
        splashOpacity.opacity = 0;
        this.splashTween = tween(splashOpacity)
            .to(0.3, { opacity: 255 }, { easing: 'quadOut' })
            .call(() => {
                this.splashTween = null;
                showText();
            })
            .start();
    }

    // 整局失败时接续当前动作，在 b 播完后柔和过渡到 b-2。
    private playDefeatAnimation(): number {
        const skeleton = this.catSpine;
        if (!skeleton?.enabledInHierarchy || skeleton.timeScale <= 0) return 0;
        const first = skeleton.findAnimation('b');
        const second = skeleton.findAnimation('b-2');
        if (!first || !second) return 0;
        const current = skeleton.getCurrent(0);
        if (current?.animation.name === 'b-2') {
            return Math.max(0, second.duration - current.trackTime) / skeleton.timeScale;
        }
        const elapsed = current?.animation.name === 'b' ? current.trackTime : 0;
        skeleton.setMix('b', 'b-2', WRONG_REACTION_MIX);
        const entry = skeleton.setAnimation(0, 'b', false);
        if (entry) entry.trackTime = elapsed;
        skeleton.addAnimation(0, 'b-2', false, first.duration);
        return (Math.max(0, first.duration - elapsed) + second.duration) / skeleton.timeScale;
    }

    // 结算收起后停下游戏音频、播放落版视频并等待跳转。
    private playEndCard(): void {
        this.endCardState = 'playing';
        if (this.audio) this.audio.enabled = false;
        if (this.endCard) {
            this.endCard.play(this.onEndCardComplete.bind(this));
        } else {
            this.onEndCardComplete();
        }
    }

    // 优先补全已输入的前缀，并用 Tween 循环淡入淡出提示字母。
    private showHint(): void {
        const candidates = WORDS.filter(word =>
            word.length === this.wordLength && !this.foundWords.has(word),
        );
        const prefix = this.selectedWord;
        const matchingWord = candidates.find(word => word.startsWith(prefix));
        const hint = matchingWord ?? candidates[0];
        if (!hint) {
            return;
        }

        const startIndex = matchingWord ? prefix.length : 0;
        const opacities = this.slotOpacities.slice(startIndex, hint.length);
        for (let index = startIndex; index < hint.length; index++) {
            const button = this.buttons[this.buttonLetters.indexOf(hint[index])];
            this.setSlotFrame(this.slotSprites[index], button?.getComponent(Sprite)?.spriteFrame ?? null);
            this.slotOpacities[index].opacity = 0;
        }
        const fade = { opacity: 0 };
        // 将同一个补间进度同步给本轮所有提示字母。
        const updateOpacity = () => {
            for (const target of opacities) {
                target.opacity = Math.round(fade.opacity);
            }
        };
        const fadeOptions = { easing: 'sineInOut' as const, onUpdate: updateOpacity };
        this.hintTween = tween(fade).repeatForever(tween<{ opacity: number }>()
            .to(HINT_FADE_PERIOD / 2, { opacity: 184 }, fadeOptions)
            .to(HINT_FADE_PERIOD / 2, { opacity: 0 }, fadeOptions))
            .start();
    }

    // 清除提示的透明度，并恢复玩家本来选中的字母。
    private clearHint(): void {
        this.idleTime = 0;
        if (!this.hintTween) {
            return;
        }
        this.hintTween.stop();
        this.hintTween = null;
        for (const opacity of this.slotOpacities) {
            opacity.opacity = 255;
        }
        this.refreshSlots();
    }

    // 点按单个字母时填入一格，填满本轮空格后自动判定。
    public onLetterClick(event: EventTouch): void {
        if (this.handledEnd === event || this.gesture || this.locked) {
            return;
        }
        const button = event.currentTarget?.getComponent(Button);
        if (button && this.select(button) && this.selectedButtons.length === this.wordLength) {
            this.submit();
        }
    }

    // 撤回点中的字母，恢复按钮大小并让后面的字母向左补位。
    public onSlotClick(_event: EventTouch, slotIndex: string): void {
        const index = Number(slotIndex);
        const button = this.selectedButtons[index];
        if (this.locked || this.gesture || !button) {
            return;
        }
        this.selectedButtons.splice(index, 1);
        this.stopLetterPop(button.node);
        this.refreshSlots();
    }

    // 记录手势起点，等待后续移动来区分点按和滑动。
    private onWheelStart(event: EventTouch): void {
        if (this.locked || this.gesture) {
            return;
        }
        this.handledEnd = null;
        const first = this.hitLetter(event);
        if (first?.interactable) {
            this.gesture = { id: event.getID(), first, dragging: false };
        }
    }

    // 开始连字后按经过顺序填字，同一次滑动只记录每个按钮一次。
    private onWheelMove(event: EventTouch): void {
        const gesture = this.gesture;
        if (!gesture || gesture.id !== event.getID() || this.locked) {
            return;
        }

        const next = this.hitLetter(event);
        if (next && next !== gesture.first) {
            if (!gesture.dragging) {
                gesture.dragging = true;
                this.resetSelection();
                this.select(gesture.first);
            }
            if (this.selectedButtons.indexOf(next) === -1 && this.select(next)) {
                this.drawTrail();
            }
        }
    }

    // 松手时补录尚未选中的字母，并判定完整的滑动输入。
    private onWheelEnd(event: EventTouch): void {
        const gesture = this.gesture;
        if (!gesture || gesture.id !== event.getID()) {
            return;
        }
        this.gesture = null;
        this.trail.clear();
        if (gesture.dragging) {
            this.handledEnd = event;
            const last = this.hitLetter(event);
            if (last && this.selectedButtons.indexOf(last) === -1) {
                this.select(last);
            }
            if (!this.locked && this.selectedButtons.length === this.wordLength) {
                this.submit();
            }
        }
    }

    // 获取触点所在的字母按钮，连字时也能识别已选按钮。
    private hitLetter(event: EventTouch): Button | undefined {
        const location = event.getLocation();
        return this.buttons.find(button => button.getComponent(UITransform).hitTest(location, event.windowId));
    }

    // 根据本轮词长配额确定需要显示的空格数。
    private get wordLength(): number {
        return WORDS[this.foundWords.size]?.length ?? 0;
    }

    // 按选中顺序读取每个按钮在检查器里配置的字母。
    private get selectedWord(): string {
        return this.selectedButtons.map(button => this.buttonLetters.charAt(this.buttons.indexOf(button))).join('');
    }

    // 填入一个字母，收起开场指引并播放选字反馈。
    private select(button: Button): boolean {
        if (this.locked || !button.interactable || this.selectedButtons.length >= this.wordLength
            || this.buttons.indexOf(button) === -1) {
            return false;
        }
        const slot = this.slotSprites[this.selectedButtons.length];
        if (this.letterGuideTween) this.hideLetterGuide();
        this.selectedButtons.push(button);
        this.refreshSlots();
        this.playLetterPop(button.node, 0.90, 1.12);
        this.playLetterPop(slot.node, 0.65, 1.16);
        this.audio?.playLetter();
        return true;
    }

    // 让字母从缩小状态弹到较大尺寸，再回到原始大小。
    private playLetterPop(node: Node, startScale: number, peakScale: number): void {
        this.stopLetterPop(node);
        const scale = node.scale.clone();
        const peak = new Vec3(scale.x * peakScale, scale.y * peakScale, scale.z);
        node.setScale(scale.x * startScale, scale.y * startScale, scale.z);
        const animation = tween(node)
            .to(0.10, { scale: peak }, { easing: 'quadOut' })
            .to(0.14, { scale }, { easing: 'sineOut' })
            .call(() => { this.letterPops.delete(node); });
        this.letterPops.set(node, { scale, animation });
        animation.start();
    }

    // 停止尚未播完的字母动画并恢复节点本来的尺寸。
    private stopLetterPop(node: Node): void {
        const pop = this.letterPops.get(node);
        if (pop) {
            pop.animation.stop();
            node.setScale(pop.scale);
            this.letterPops.delete(node);
        }
    }

    // 校验单词，答错先扣时，再根据是否超时选择单题反馈或整局结算。
    private submit(): void {
        this.updateCountdown();
        if (this.finished) {
            return;
        }
        this.locked = true;
        const word = this.selectedWord;
        if (WORDS.indexOf(word) === -1 || this.foundWords.has(word)) {
            if (this.countdownDeadline !== null) {
                this.countdownDeadline -= WRONG_ANSWER_PENALTY_MS;
                this.updateCountdown();
            }
            if (!this.finished) {
                this.playCatReaction(false);
                this.audio?.playAnswer(false);
                this.playWrongFeedback();
            }
            return;
        }

        this.foundWords.add(word);
        this.playCatReaction(true);
        this.audio?.playAnswer(true);
        this.title?.setRemainingWords(TOTAL_WORDS - this.foundWords.size);
        this.playConfetti();
        if (this.foundWords.size >= TOTAL_WORDS) {
            this.finishGame(true);
            return;
        }
        this.scheduleOnce(() => {
            if (this.finished) {
                return;
            }
            this.showRound();
            this.row.setPosition(this.rowPosition.x + 48, this.rowPosition.y, this.rowPosition.z);
            tween(this.row).to(0.22, { position: this.rowPosition }, { easing: 'quadOut' })
                .call(() => { this.locked = this.finished; })
                .start();
        }, 0.45);
    }

    // 答错依次播放 b、b-2 和 b to a，答对连播两次 c，最后循环待机 a。
    private playCatReaction(correct: boolean): void {
        const skeleton = this.catSpine;
        if (!skeleton) return;

        skeleton.setAnimation(0, correct ? 'c' : 'b', false);
        if (correct) {
            skeleton.addAnimation(0, 'c', false, 0);
        } else {
            skeleton.setMix('b', 'b-2', WRONG_REACTION_MIX);
            const duration = skeleton.findAnimation('b')?.duration ?? 0;
            skeleton.addAnimation(0, 'b-2', false, duration);
            skeleton.addAnimation(0, 'b to a', false, 0);
        }
        skeleton.addAnimation(0, 'a', true, 0);
    }

    // 用半秒 Tween 显示红色背景、短暂停留并淡出。
    private playWrongFeedback(): void {
        const opacity = this.wrongBackgroundOpacity;
        if (!opacity) {
            this.scheduleOnce(this.finishWrongFeedback, WRONG_FEEDBACK_DURATION);
            return;
        }
        this.wrongFeedbackTween?.stop();
        opacity.opacity = 0;
        opacity.node.active = true;
        this.wrongFeedbackTween = tween(opacity)
            .to(0.08, { opacity: 255 }, { easing: 'quadOut' })
            .delay(0.12)
            .to(WRONG_FEEDBACK_DURATION - 0.2, { opacity: 0 }, { easing: 'quadIn' })
            .call(this.finishWrongFeedback.bind(this))
            .start();
    }

    // 隐藏答错背景，时间还有剩余时清空输入并允许重试。
    private finishWrongFeedback(): void {
        this.wrongFeedbackTween = null;
        if (this.wrongBackground) {
            this.wrongBackground.active = false;
        }
        if (!this.finished) {
            this.resetSelection();
            this.locked = false;
        }
    }

    // 清空旧答案，将本轮题号和白色横线排成一行并整体居中。
    private showRound(): void {
        this.clearHint();
        this.resetSelection();
        const firstCell = this.slotSprites[0].node.parent;
        const pitch = firstCell.getComponent(UITransform).width;
        const lineWidth = this.firstUnderline.width;
        const numberWidth = this.roundNumber
            ? this.roundNumber.getComponent(UITransform).width + NUMBER_GAP
            : 0;
        const length = this.wordLength;
        const rowWidth = numberWidth + lineWidth + (length - 1) * pitch;
        const startX = -rowWidth / 2 + numberWidth + lineWidth / 2;
        if (this.roundNumber) {
            this.roundNumber.string = `${this.foundWords.size + 1}.`;
            const node = this.roundNumber.node;
            node.setPosition(-rowWidth / 2 + (numberWidth - NUMBER_GAP) / 2, node.position.y, node.position.z);
        }

        this.row.getComponent(UITransform).width = rowWidth + ROW_PADDING * 2;
        this.slotSprites.forEach((slot, index) => {
            const cell = slot.node.parent;
            cell.active = index < length;
            cell.setPosition(startX + index * pitch, cell.position.y, cell.position.z);
        });
    }

    // 恢复已选按钮的原始尺寸，并清空输入和连线。
    private resetSelection(): void {
        for (const button of this.selectedButtons) {
            this.stopLetterPop(button.node);
        }
        this.selectedButtons.length = 0;
        this.trail.clear();
        this.refreshSlots();
    }

    // 将已选择的字母同步到横线上方，并保持图片比例。
    private refreshSlots(): void {
        this.slotSprites.forEach((slot, index) => {
            const frame = this.selectedButtons[index]?.getComponent(Sprite)?.spriteFrame ?? null;
            this.setSlotFrame(slot, frame);
        });
    }

    // 更换槽里的字母时结束旧动画，并按图片原比例调整宽度。
    private setSlotFrame(slot: Sprite, frame: SpriteFrame | null): void {
        if (slot.spriteFrame !== frame) {
            this.stopLetterPop(slot.node);
        }
        slot.spriteFrame = frame;
        if (frame) {
            const transform = slot.getComponent(UITransform);
            transform.width = transform.height * frame.rect.width / frame.rect.height;
        }
    }

    // 创建跟随父节点的轻量绘制图层。
    private createGraphics(parent: Node, name: string): Graphics {
        const node = new Node(name);
        node.layer = parent.layer;
        parent.addChild(node);
        return node.addComponent(Graphics);
    }

    // 在已选字母之间绘制金色连线。
    private drawTrail(): void {
        this.trail.clear();
        this.trail.lineWidth = 8;
        this.trail.strokeColor = new Color(255, 209, 76, 220);
        this.selectedButtons.forEach((button, index) => {
            const { x, y } = button.node.position;
            if (index === 0) {
                this.trail.moveTo(x, y);
            } else {
                this.trail.lineTo(x, y);
            }
        });
        this.trail.stroke();
    }

    // 答对时播放礼花和庆祝音效，并在一秒后停止粒子。
    private playConfetti(): void {
        const root = this.confettiRoot;
        if (!root?.isValid) {
            return;
        }
        this.stopConfetti();
        root.active = true;
        for (const particle of this.confettiParticles) {
            if (particle.enabledInHierarchy && particle.capacity > 0) {
                particle.play();
            }
        }
        this.audio?.playCelebration();
        this.confettiTween = tween(root)
            .delay(CONFETTI_DURATION)
            .call(() => {
                this.confettiTween = null;
                this.stopConfetti();
            })
            .start();
    }

    // 清除上一轮礼花粒子，取消计时并隐藏礼花节点。
    private stopConfetti(): void {
        this.confettiTween?.stop();
        this.confettiTween = null;
        if (!this.confettiRoot?.isValid || !this.confettiRoot.active) {
            return;
        }
        for (const particle of this.confettiParticles) {
            if (particle.enabledInHierarchy) {
                particle.stop();
            }
        }
        this.confettiRoot.active = false;
    }
}
