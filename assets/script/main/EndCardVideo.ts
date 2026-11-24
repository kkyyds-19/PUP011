import {
    _decorator, BlockInputEvents, Component, Node, Tween, UIOpacity,
    UITransform, VideoClip, VideoPlayer, sys, tween, view,
} from 'cc';
import { AdaptScreenManager, ResizeEvent } from '../Adapt/AdaptScreenManager';

const { ccclass, property } = _decorator;
const STARTUP_TIMEOUT = 15;
const FADE_DURATION = 0.22;

@ccclass('EndCardVideo')
export class EndCardVideo extends Component {
    @property({ type: VideoClip, tooltip: '绑定倒计时结束后自动播放一次的落版视频。' })
    private clip: VideoClip | null = null;

    @property({ type: VideoPlayer, tooltip: '绑定落版播放器；其节点上的 VideoPlayOnTouch 负责适配。' })
    private video: VideoPlayer | null = null;

    @property({ type: Node, tooltip: '绑定 PUP 的黑色遮罩节点，作为落版视频的底色。' })
    private blackNode: Node | null = null;

    private backgroundOpacity: UIOpacity | null = null;
    private onComplete: (() => void) | null = null;
    private videoFade: Tween<{ opacity: number }> | null = null;

    // 显示 PUP 遮罩和落版播放器，静音播放一次并等待结束。
    public play(onComplete: () => void): void {
        if (this.onComplete) {
            return;
        }
        this.onComplete = onComplete;
        const video = this.video;
        if (!this.clip || !video || !this.blackNode) {
            this.complete();
            return;
        }

        const overlay = this.node;
        this.backgroundOpacity = this.blackNode.getComponent(UIOpacity) ?? this.blackNode.addComponent(UIOpacity);
        if (!this.getComponent(BlockInputEvents)) {
            this.addComponent(BlockInputEvents);
        }
        this.backgroundOpacity.opacity = 0;
        overlay.setSiblingIndex(overlay.parent.children.length - 1);
        this.blackNode.active = true;
        overlay.active = true;

        const videoNode = video.node;
        video.playOnAwake = false;
        video.loop = false;
        video.fullScreenOnAwake = false;
        video.stayOnBottom = false;
        video.mute = true;
        videoNode.on(VideoPlayer.EventType.PLAYING, this.onPlaying, this);
        videoNode.on(VideoPlayer.EventType.COMPLETED, this.complete, this);
        videoNode.on(VideoPlayer.EventType.ERROR, this.onPlaybackFailed, this);
        video.clip = this.clip;
        const dom = sys.isBrowser ? video.nativeVideo : null;
        if (dom) {
            dom.style.opacity = '0';
        }
        this.fitOverlay();
        AdaptScreenManager.eventTarget.on(ResizeEvent, this.fitOverlay, this);
        tween(this.backgroundOpacity).to(FADE_DURATION, { opacity: 255 }).start();
        this.scheduleOnce(this.onPlaybackFailed, STARTUP_TIMEOUT);
        video.play();
    }

    // 让落版遮罩的拦截区域随可视区变化。
    private fitOverlay(): void {
        const { width, height } = view.getVisibleSize();
        this.getComponent(UITransform).setContentSize(width, height);
    }

    // 视频开始播放后淡入画面，并按视频时长设置结束兜底。
    private onPlaying(): void {
        if (!this.onComplete || !this.video) {
            return;
        }
        const dom = sys.isBrowser ? this.video.nativeVideo : null;
        if (dom && dom.style.opacity !== '1' && !this.videoFade) {
            const fade = { opacity: 0 };
            this.videoFade = tween(fade).to(FADE_DURATION, { opacity: 1 }, {
                onUpdate: () => { dom.style.opacity = String(fade.opacity); },
            }).start();
        }
        const duration = this.video.duration;
        if (Number.isFinite(duration) && duration > 0) {
            this.unschedule(this.onPlaybackFailed);
            this.scheduleOnce(this.onPlaybackFailed, Math.max(0, duration - this.video.currentTime) + 2);
        }
    }

    // 播完保留最后一帧，并且只通知主流程一次。
    private complete(): void {
        const callback = this.onComplete;
        this.onComplete = null;
        this.unschedule(this.onPlaybackFailed);
        callback?.();
    }

    // 视频加载失败或超时则撤下落版，继续执行跳转。
    private onPlaybackFailed(): void {
        if (!this.onComplete) {
            return;
        }
        this.disposeOverlay();
        this.node.active = false;
        this.complete();
    }

    // 停止落版动画和尺寸监听，并清空场景播放器的播放资源。
    private disposeOverlay(): void {
        AdaptScreenManager.eventTarget.off(ResizeEvent, this.fitOverlay, this);
        this.videoFade?.stop();
        this.videoFade = null;
        if (this.backgroundOpacity) {
            Tween.stopAllByTarget(this.backgroundOpacity);
        }
        if (this.video?.node.isValid) {
            this.video.node.targetOff(this);
            this.video.clip = null;
        }
        this.backgroundOpacity = null;
    }

    // 场景销毁时释放落版，避免误触发商店跳转。
    protected onDestroy(): void {
        this.onComplete = null;
        this.disposeOverlay();
    }
}
