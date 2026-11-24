import {
    _decorator, BlockInputEvents, Color, Component, game, Graphics, ImageAsset,
    Node, Sprite, SpriteFrame, sys, Tween, tween, UIOpacity, UITransform, VideoClip, VideoPlayer, view,
} from 'cc';

const { ccclass, property } = _decorator;

// 按钩子视频的英语配音标记各词的起始时间，单位为秒。
const CAPTION_LINES: ReadonlyArray<ReadonlyArray<readonly [number, string]>> = [
    [[0.18, 'This'], [0.20, 'is'], [0.32, 'actually'], [0.73, 'one'], [0.86, 'of'], [0.96, 'the'], [1.11, 'most']],
    [[1.42, 'addicting'], [1.80, 'games'], [2.00, 'I’ve'], [2.47, 'played.']],
    [[2.84, 'You'], [3.02, 'basically'], [3.48, 'make'], [3.69, 'words'], [3.96, 'from']],
    [[4.26, 'these'], [4.44, 'letters.']],
];

@ccclass('IntroVideo')
export class IntroVideo extends Component {
    @property({ type: VideoClip, tooltip: '绑定首次点击后播放的开场视频，视频自带音轨。' })
    private clip: VideoClip | null = null;

    @property({ type: VideoPlayer, tooltip: '绑定开场播放器，其节点上的 VideoPlayOnTouch 负责画面适配。' })
    private video: VideoPlayer | null = null;

    @property({ type: ImageAsset, tooltip: '绑定在开场视频上循环缩放的 PUP 指引手图片。' })
    private handImage: ImageAsset | null = null;

    @property({ tooltip: '设置 Web 开场视频的播放倍速。' })
    private playbackRate = 1.5;

    private backdrop: Graphics | null = null;
    private handOverlay: HTMLDivElement | null = null;
    private handTween: Tween<{ scale: number }> | null = null;
    private captionOverlay: HTMLDivElement | null = null;
    private captionLine = -1;
    private highlightedWord = -1;
    private transition: Tween<{ opacity: number }> | null = null;
    private onInput: (() => void) | null = null;
    private onComplete: ((requested: boolean) => void) | null = null;
    private onLastFrame: (() => void) | null = null;
    private lastFrame: Sprite | null = null;
    private requested = false;
    private videoStarted = false;
    private closing = false;

    // 展示开场提示，按需在播放结束后保留最后一帧。
    public prepare(onInput: () => void, onComplete: (requested: boolean) => void,
        onLastFrame: (() => void) | null = null): boolean {
        const video = this.video;
        if (!video || !this.clip) return false;
        this.onInput = onInput;
        this.onComplete = onComplete;
        this.onLastFrame = onLastFrame;
        this.backdrop = this.getComponent(Graphics) ?? this.addComponent(Graphics);
        this.addComponent(BlockInputEvents);
        this.node.setSiblingIndex(this.node.parent.children.length - 1);
        video.playOnAwake = false;
        video.loop = false;
        video.mute = false;
        video.node.on(VideoPlayer.EventType.READY_TO_PLAY, this.onReady, this);
        video.node.on(VideoPlayer.EventType.PLAYING, this.onPlaying, this);
        video.node.on(VideoPlayer.EventType.COMPLETED, this.onEnded, this);
        video.node.on(VideoPlayer.EventType.ERROR, this.close, this);
        video.clip = this.clip;
        this.node.active = true;
        this.update();
        if (sys.isBrowser) {
            document.addEventListener('touchend', this.onWebTap, true);
            document.addEventListener('click', this.onWebTap, true);
        } else {
            this.node.on(Node.EventType.TOUCH_END, this.requestPlay, this);
        }
        return true;
    }

    public test() :void{
        console.log('提交测试')
    }

    // 保持底板铺满可视区，播放期间更新视频提示和字幕。
    protected update(): void {
        const { width, height } = view.getVisibleSize();
        const size = this.getComponent(UITransform);
        if (this.backdrop && (size.width !== width || size.height !== height || !this.backdropReady)) {
            size.setContentSize(width, height);
            this.backdrop.clear();
            this.backdrop.fillColor = Color.BLACK;
            this.backdrop.rect(-width / 2, -height / 2, width, height);
            this.backdrop.fill();
            this.backdropReady = true;
        }
        if (!sys.isBrowser || this.closing || this.lastFrame) return;
        if (this.videoStarted) this.updateCaptions();
        else this.showHand();
    }

    private backdropReady = false;

    // 仅接受来自游戏区域的网页点击或触摸。
    private readonly onWebTap = (event: Event): void => {
        if (event.target instanceof HTMLElement && game.canvas?.parentElement?.contains(event.target)) {
            this.requestPlay();
        }
    };

    // 在真实手势内直接调用视频元素，兼容要求同步播放的移动浏览器。
    private requestPlay(): void {
        if (!this.onComplete || this.closing || !this.video || this.video.isPlaying) return;
        if (!this.requested) {
            this.requested = true;
            this.onInput?.();
            this.scheduleOnce(this.close, 8);
        }
        const dom = sys.isBrowser ? this.video.nativeVideo : null;
        if (dom) {
            dom.playsInline = true;
            dom.playbackRate = Math.max(0.1, this.playbackRate);
            void dom.play().catch(() => { /* 保留手势监听，允许再次点击。 */ });
        } else {
            this.video.play();
        }
    }

    // 视频就绪时补播已收到手势的请求。
    private onReady(): void {
        if (this.requested) this.requestPlay();
    }

    // 视频真正播起来后收起提示，并为播放中断设置超时兜底。
    private onPlaying(): void {
        this.videoStarted = true;
        this.removeHand();
        this.unschedule(this.close);
        const dom = sys.isBrowser ? this.video.nativeVideo : null;
        const duration = dom?.duration ?? this.video.duration;
        this.scheduleOnce(this.close, Number.isFinite(duration)
            ? Math.max(0, duration - this.video.currentTime) / (dom?.playbackRate || 1) + 2 : 12);
    }

    // 按 PUP 的位置和节奏在视频上方显示指引手。
    private showHand(): void {
        if (this.handOverlay) return;
        const parent = this.video?.nativeVideo?.parentElement ?? game.canvas?.parentElement;
        const image = this.handImage;
        const url = image?.data instanceof HTMLImageElement ? image.data.src || image.nativeUrl : image?.nativeUrl;
        if (!parent || !url) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:99999';
        const hand = document.createElement('img');
        hand.src = url;
        hand.alt = '';
        hand.draggable = false;
        hand.style.cssText = 'position:relative;left:30px;height:min(18vw,84px);width:auto;display:block;transform-origin:50% 100%;filter:drop-shadow(0 3px 8px rgba(0,0,0,.65))';
        overlay.appendChild(hand);
        parent.appendChild(overlay);
        this.handOverlay = overlay;
        const pose = { scale: 1 };
        // 将指引手的缩放进度同步到视频上方的图片。
        const applyPose = (): void => {
            hand.style.transform = `rotate(-30deg) scale(${pose.scale})`;
        };
        applyPose();
        this.handTween = tween(pose).repeatForever(tween(pose)
            .to(0.45, { scale: 0.86 }, { easing: 'sineInOut', onUpdate: applyPose })
            .to(0.45, { scale: 1 }, { easing: 'sineInOut', onUpdate: applyPose })).start();
    }

    // 停止点击指引动画并移除网页图片。
    private removeHand(): void {
        this.handTween?.stop();
        this.handTween = null;
        this.handOverlay?.remove();
        this.handOverlay = null;
    }

    // 以播放器为定位基准，用视频时间切换字幕和逐词高亮。
    private updateCaptions(): void {
        const video = this.video?.nativeVideo;
        if (!video?.parentElement || !video.style.width) return;
        const time = video.currentTime;
        let index = CAPTION_LINES.length - 1;
        while (index >= 0 && time < CAPTION_LINES[index][0][0]) index--;
        if (index < 0) {
            if (this.captionOverlay) this.captionOverlay.style.visibility = 'hidden';
            return;
        }

        let overlay = this.captionOverlay;
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute;pointer-events:none;z-index:99999;color:white;text-align:center';
            const line = document.createElement('div');
            line.style.cssText = 'position:absolute;bottom:5.5%;left:0;right:0;font:700 1em/1.25 Arial,sans-serif;white-space:pre;text-shadow:0 1px 3px #000,0 1px 6px #000';
            overlay.appendChild(line);
            video.parentElement.appendChild(overlay);
            this.captionOverlay = overlay;
        }
        const style = overlay.style;
        style.left = video.style.left;
        style.bottom = video.style.bottom;
        style.width = video.style.width;
        style.height = video.style.height;
        style.transformOrigin = video.style.transformOrigin;
        style.transform = video.style.transform;
        style.fontSize = `${parseFloat(video.style.width) * 0.047}px`;
        style.visibility = video.style.visibility;

        const line = overlay.firstElementChild;
        const words = CAPTION_LINES[index];
        if (index !== this.captionLine) {
            line.textContent = '';
            words.forEach(([, text], i) => {
                if (i > 0) line.appendChild(document.createTextNode(' '));
                const word = document.createElement('span');
                word.textContent = text;
                line.appendChild(word);
            });
            this.captionLine = index;
            this.highlightedWord = -1;
        }
        let highlighted = words.length - 1;
        while (time < words[highlighted][0]) highlighted--;
        if (highlighted !== this.highlightedWord) {
            const previous = line.children[this.highlightedWord] as HTMLElement | undefined;
            if (previous) previous.style.backgroundColor = '';
            const word = line.children[highlighted] as HTMLElement;
            word.style.backgroundColor = '#613995';
            this.highlightedWord = highlighted;
        }
    }

    // 将网页视频的最后一帧交给 Cocos 渲染，让场景按钮盖在画面上。
    private onEnded(): void {
        if (this.closing || this.lastFrame) return;
        const dom = sys.isBrowser ? this.video?.nativeVideo : null;
        if (!this.onLastFrame || !dom?.videoWidth || !dom.videoHeight) {
            this.close();
            return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = dom.videoWidth;
        canvas.height = dom.videoHeight;
        const context = canvas.getContext('2d');
        if (!context) {
            this.close();
            return;
        }
        let frame: SpriteFrame;
        try {
            context.drawImage(dom, 0, 0);
            context.getImageData(0, 0, 1, 1);
            frame = SpriteFrame.createWithImage(canvas);
        } catch {
            this.close();
            return;
        }
        frame.packable = false;
        const sprite = this.video.node.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = frame;
        this.lastFrame = sprite;
        this.unschedule(this.close);
        this.detachInput();
        this.captionOverlay?.remove();
        this.captionOverlay = null;
        dom.style.opacity = '0';
        this.onLastFrame();
    }

    // 开局按钮点下时结束最后一帧的停留并开始淡出。
    public dismissLastFrame(): boolean {
        if (!this.lastFrame || this.closing) return false;
        this.close();
        return true;
    }

    // 视频画面先淡出到黑底，黑底再淡出并交回游戏控制。
    private close(): void {
        if (!this.onComplete || this.closing) return;
        this.closing = true;
        this.unschedule(this.close);
        this.detachInput();
        this.removeHand();
        const dom = sys.isBrowser ? this.video?.nativeVideo : null;
        dom?.pause();
        const opacity = this.getComponent(UIOpacity) ?? this.addComponent(UIOpacity);
        const stillOpacity = this.lastFrame?.node.addComponent(UIOpacity);
        this.transition = tween({ opacity: 1 })
            .to(dom ? 0.25 : 0, { opacity: 0 }, {
                onUpdate: value => {
                    if (stillOpacity) stillOpacity.opacity = 255 * value.opacity;
                    else if (dom) dom.style.opacity = String(value.opacity);
                    if (this.captionOverlay) this.captionOverlay.style.opacity = String(value.opacity);
                },
            })
            .call(() => {
                this.video.node.active = false;
                this.video.clip = null;
                this.releaseLastFrame();
                this.captionOverlay?.remove();
                this.captionOverlay = null;
            })
            .to(0.3, { opacity: 1 }, {
                onUpdate: value => { opacity.opacity = 255 * (1 - value.opacity); },
            })
            .call(() => {
                const complete = this.onComplete;
                this.onComplete = null;
                this.node.active = false;
                complete?.(this.requested);
            })
            .start();
    }

    // 解绑并释放用于显示视频最后一帧的临时纹理。
    private releaseLastFrame(): void {
        const sprite = this.lastFrame;
        if (!sprite) return;
        this.lastFrame = null;
        const frame = sprite.spriteFrame;
        sprite.spriteFrame = null;
        frame?.texture.destroy();
        frame?.destroy();
    }

    // 解除开场的页面和引擎手势监听。
    private detachInput(): void {
        if (sys.isBrowser) {
            document.removeEventListener('touchend', this.onWebTap, true);
            document.removeEventListener('click', this.onWebTap, true);
        }
        this.node.targetOff(this);
    }

    // 在场景退出时清理视频监听和开场动画。
    protected onDestroy(): void {
        this.detachInput();
        this.video?.node.targetOff(this);
        this.removeHand();
        this.captionOverlay?.remove();
        this.transition?.stop();
        this.releaseLastFrame();
    }
}
