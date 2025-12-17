const LOCAL_ASSETS_PATH = '../assets/';

const sleep = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

class EventController {
    constructor(id, dir = 'produce_events', allView = true, audioCtrl) {
        this.id = id;
        this.dir = dir;
        this.allView = allView;
        this.nowPageIndex = 0;
        this.isMute = true;
        this.audioController = audioCtrl; // 外部から注入
        this.container = document.querySelector('.message-container');
        this.scrollHandler = null;
        this.mouseMoveHandler = null;
        this.mouseLeaveHandler = null;
        this.nowBackground = null;

        this.bgLayers = [document.getElementById('bg1'), document.getElementById('bg2')];
        this.bgIndex = 0;

        this.mouseY = null;

        this.selectInstance = null;
    }

    async init() {
        await this.loadNameAliasMap();
        await this.getEventData();
        // await this.preloadAssets();

        if (this.allView) {
            this.viewAll();
        } else {
            this.viewOneByOne();
        }
    }

    async getEventData() {
        const localUrl = `${LOCAL_ASSETS_PATH}/json/${this.dir}/${this.id}.json`;
        const onlineUrl = `https://viewer.shinycolors.moe/json/${this.dir}/${this.id}.json`;

        // ローカル → オンラインの順にフェールオーバー
        try {
            const res = await fetch(localUrl);
            if (!res.ok) {
                throw new Error(`Local fetch failed: ${res.status}`);
            }
            this.eventData = await res.json();
            return;
        } catch (e) {
            console.warn(`Local JSON not found, trying online source...`, e);
        }

        // オンライン
        try {
            const resOnline = await fetch(onlineUrl);
            if (!resOnline.ok) {
                throw new Error(`Online fetch failed: ${resOnline.status}`);
            }
            this.eventData = await resOnline.json();
        } catch (e) {
            console.error(`Failed to fetch both local and online JSON`, e);
            throw e;
        }
    }

    async preloadAssets() {
        const bgmFiles = [];
        const seFiles = [];
        const voiceFiles = [];

        for (const e of this.eventData) {
            if (e.bgm) bgmFiles.push(`https://viewer.shinycolors.moe/sounds/bgm/${e.bgm}.m4a`);
            if (e.se) seFiles.push(`https://viewer.shinycolors.moe/sounds/se/event/${e.se}.m4a`);
            if (e.voice) voiceFiles.push(`https://viewer.shinycolors.moe/sounds/voice/events/${e.voice}.m4a`);
        }

        // 重複を除去
        const unique = (arr) => [...new Set(arr)];

        await Promise.all([this.audioController.preload(unique(bgmFiles), 'bgm'), this.audioController.preload(unique(seFiles), 'se'), this.audioController.preload(unique(voiceFiles), 'voice')]);
    }

    async loadNameAliasMap() {
        const url = 'name_list.json';
        try {
            const res = await fetch(url);
            const json = await res.json();
            this.nameAliasMap = json;
            return true;
        } catch (err) {
            console.error('nameAliasMapの読み込みに失敗しました:', err);
            return false;
        }
    }

    async turnPage(i) {
        if (i >= this.eventData.length - 1) return i;

        const e = this.eventData[i];

        if ('bg' in e) {
            this.changeBG(e.bg);
            this.nowBackground = e.bg;
        }
        if ('bgm' in e) this.changeBGM(e.bgm);
        if ('se' in e && !('waitTime' in e)) this.changeSE(e.se);
        if ('textFrame' in e && e.textFrame !== 'off') new Message(this, e, this.audioController, this.isMute, this.nowBackground);
        if ('textCtrl' in e && e.textCtrl === 'l') this.selectInstance = new Select(this, this.eventData, i);

        if ('nextLabel' in e && !('select' in e)) {
            // nextLabel が存在し、select が存在しない場合は nextLabel へジャンプ
            const targetIndex = this.searchLabelIndex(e.nextLabel);
            if (targetIndex !== -1) {
                return targetIndex;
            } else {
                console.warn(`Label not found: ${e.nextLabel}`);
                return this.turnPage(++i);
            }
        } else if ('textCtrl' in e && (e.textCtrl === 'p' || e.textCtrl === 'l')) {
            return i;
        } else {
            return this.turnPage(++i);
        }
    }

    searchLabelIndex(label) {
        for (let i = 0; i < this.eventData.length; i++) {
            const e = this.eventData[i];
            if ('label' in e && e.label === label) {
                return i;
            }
        }
        return -1;
    }

    async viewAll() {
        this.isMute = true;

        for (let i = 0; i <= this.eventData.length; i++) {
            i = await this.turnPage(i);
        }

        const bottom = this.container.scrollHeight - this.container.clientHeight;
        this.container.scroll(0, -bottom);

        // 背景をリセット
        await sleep(1);
        this.nowBackground = null;
        await this.changeBG('00000');

        // スクロール位置に応じて背景を変更するオブザーバーを初期化
        this.initScrollBGObserver();

        this.selectInstance.selectedIndex = 0;
        this.selectInstance.selectElements.forEach((div, index) => {
            // 最初の要素を選択状態にする
            if (index === 0) {
                div.classList.add('selected');
                div.classList.remove('unselected');
            } else {
                div.classList.add('unselected');
                div.classList.remove('selected');
            }

            // クリックイベントを追加
            div.addEventListener('click', async () => {
                if (div.classList.contains('selected')) return;

                const nextIndex = this.selectInstance.getNextIndex();

                for (let i = nextIndex; i < this.eventData.length; i++) {
                    i = await this.turnPage(i);
                }
            });
        });
    }

    async viewOneByOne() {
        this.isMute = false;
        this.nowPageIndex = 0;

        // this バインド済みのハンドラを保持
        this.boundAdvanceHandler = this.advanceMessage.bind(this);
        this.boundKeyHandler = this.keyDownHandler.bind(this);

        document.addEventListener('click', this.boundAdvanceHandler);
        document.addEventListener('keydown', this.boundKeyHandler);
    }

    async advanceMessage(e) {
        if (this.nowPageIndex >= this.eventData.length - 1) return;

        // クリックイベントの場合の追加判定
        if (e?.type === 'click') {
            // 音声再生ボタン押下時は無視
            if (e.target?.classList?.contains('button-element')) return;
        }

        // 選択待機状態の場合は無視
        if (this.selectInstance && this.selectInstance.isActive()) return;

        const bottom = this.container.scrollHeight - this.container.clientHeight;
        this.container.scroll(0, bottom);

        const messageUl = document.querySelector('.message-ul');
        this.nowPageIndex = await this.turnPage(this.nowPageIndex);

        const liHeight = [...messageUl.childNodes].pop().clientHeight;
        messageUl.style.setProperty('transition', '');
        messageUl.style.setProperty('transform', `translateY(${liHeight}px)`);

        await sleep(1);
        messageUl.style.setProperty('transition', 'transform 200ms ease-out');
        messageUl.style.setProperty('transform', 'translateY(0)');

        this.nowPageIndex++;
    }

    keyDownHandler(e) {
        // スペースキーのみ対象
        if (e.code !== 'Space') return;

        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        e.preventDefault();
        this.advanceMessage(e);
    }

    async changeBG(id) {
        // console.log(this.nowBackground, '->', id);
        if (this.nowBackground === id) return;
        this.nowBackground = id;

        const localUrl = `${LOCAL_ASSETS_PATH}images/event/bg/${id}.jpg`;
        const onlineUrl = `https://viewer.shinycolors.moe/images/event/bg/${id}.jpg`;

        // 背景のレイヤー管理
        const next = this.bgLayers[this.bgIndex];
        const prev = this.bgLayers[1 - this.bgIndex];

        // 画像読み込みを Promise 化
        const loadImage = (src) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(src);
                img.onerror = () => reject(src);
                img.src = src;
            });
        };

        let finalUrl = null;

        // ローカル → オンライン フェールオーバー
        try {
            finalUrl = await loadImage(localUrl);
        } catch (_) {
            // ローカル失敗 → オンラインへ
            try {
                finalUrl = await loadImage(onlineUrl);
            } catch (e) {
                console.error(`BG image not found: ${localUrl} / ${onlineUrl}`);
                return;
            }
        }

        // 切り替え処理
        next.style.backgroundImage = `url(${finalUrl})`;
        next.classList.add('active');
        if (prev) prev.classList.remove('active');

        this.bgIndex = 1 - this.bgIndex;
    }

    changeBGM(id) {
        if (this.isMute) return;

        if (id === 'fade_out') {
            this.audioController.fadeOutBGM();
        } else {
            this.audioController.playBGM(id);
        }
    }

    changeSE(id) {
        if (this.isMute) return;

        if (id == null) {
            this.audioController.stopSE();
        } else {
            this.audioController.playSE(id);
        }
    }

    initScrollBGObserver() {
        if (!this.allView) return;

        let ticking = false;
        const updateBG = () => {
            this.updateBGByPosition();
            ticking = false;
        };

        this.scrollHandler = () => {
            if (!ticking) {
                requestAnimationFrame(updateBG);
                ticking = true;
            }
        };
        this.mouseMoveHandler = (e) => {
            const rect = this.container.getBoundingClientRect();
            this.mouseY = e.clientY - rect.top;
            if (!ticking) {
                requestAnimationFrame(updateBG);
                ticking = true;
            }
        };
        this.mouseLeaveHandler = () => {
            this.mouseY = null;
            if (!ticking) {
                requestAnimationFrame(updateBG);
                ticking = true;
            }
        };

        this.container.addEventListener('scroll', this.scrollHandler);
        this.container.addEventListener('mousemove', this.mouseMoveHandler);
        this.container.addEventListener('mouseleave', this.mouseLeaveHandler);

        this.updateBGByPosition();
    }

    updateBGByPosition() {
        const containerRect = this.container.getBoundingClientRect();
        const refY = this.mouseY !== null ? this.mouseY + containerRect.top : containerRect.top + containerRect.height / 2;

        let closest = null;
        let closestDistance = Infinity;

        document.querySelectorAll('.message-li').forEach((li) => {
            const rect = li.getBoundingClientRect();
            const liCenter = rect.top + rect.height / 2;
            const distance = Math.abs(refY - liCenter);
            if (distance < closestDistance) {
                closestDistance = distance;
                closest = li;
            }
        });

        if (closest) {
            const bg = closest.dataset.nowBackground;
            if (bg && this.nowBackground !== bg) {
                this.changeBG(bg);
            }
        }
    }

    destroy() {
        // クリック／キー入力の解除
        if (this.boundAdvanceHandler) {
            document.removeEventListener('click', this.boundAdvanceHandler);
            this.boundAdvanceHandler = null;
        }

        if (this.boundKeyHandler) {
            document.removeEventListener('keydown', this.boundKeyHandler);
            this.boundKeyHandler = null;
        }

        // スクロール関連
        if (this.scrollHandler && this.container) {
            this.container.removeEventListener('scroll', this.scrollHandler);
            this.scrollHandler = null;
        }

        if (this.mouseMoveHandler && this.container) {
            this.container.removeEventListener('mousemove', this.mouseMoveHandler);
            this.mouseMoveHandler = null;
        }

        if (this.mouseLeaveHandler && this.container) {
            this.container.removeEventListener('mouseleave', this.mouseLeaveHandler);
            this.mouseLeaveHandler = null;
        }

        // 背景レイヤーを解放
        if (this.bgLayers) {
            this.bgLayers.forEach((layer) => {
                layer.style.backgroundImage = '';
                layer.classList.remove('active');
            });
            this.bgLayers = null;
        }

        // 内部状態の破棄
        this.eventData = null;
        this.container = null;
        this.nowBackground = null;
        this.mouseY = null;
    }
}

class Message {
    constructor(eventController, messageData, audioCtrl, isMute = true, nowBackground = null) {
        this.init(eventController, messageData, audioCtrl, isMute, nowBackground);
    }

    async init(eventController, messageData, audioCtrl, isMute, nowBackground) {
        this.eventController = eventController;

        this.data = messageData;
        this.audioController = audioCtrl;
        this.isMute = isMute;
        this.nowBackground = nowBackground;

        this.messageMode = 'idol';
        this.parentElement = document.querySelector('.message-ul');

        this.readData();
        this.createElement();

        if (!this.isMute) {
            if ('voice' in this.data) this.audioController.playVoice(this.data.voice);
            else this.audioController.stopVoice();
        }
    }

    iconNumberMap = {
        真乃: '001',
        灯織: '002',
        めぐる: '003',
        恋鐘: '004',
        摩美々: '005',
        咲耶: '006',
        結華: '007',
        霧子: '008',
        果穂: '009',
        智代子: '010',
        樹里: '011',
        凛世: '012',
        夏葉: '013',
        甘奈: '014',
        甜花: '015',
        千雪: '016',
        あさひ: '017',
        冬優子: '018',
        愛依: '019',
        透: '020',
        円香: '021',
        小糸: '022',
        雛菜: '023',
        にちか: '024',
        美琴: '025',
        ルカ: '026',
        羽那: '027',
        はるき: '028',

        // 特別枠
        はづき: '091',

        // コラボ系
        ルビー: '801',
        かな: '802',
        MEMちょ: '803',
        あかね: '804',

        // CEO（社長）
        社長: '902',
    };

    readData() {
        // textFrame
        switch (this.data.textFrame) {
            case '001':
                this.messageMode = 'idol';
                break;
            case '002':
                this.messageMode = 'p';
                break;
            case '004':
                this.messageMode = 'ceo';
                break;
            default:
                this.messageMode = 'sub';
                break;
        }

        // speaker -> icon
        const speaker = this.data.speaker;

        // 1. speaker にマッチする代表名を検索
        let mainName = null;

        for (const key in this.eventController.nameAliasMap) {
            const aliases = this.eventController.nameAliasMap[key];
            if (aliases.includes(speaker)) {
                mainName = key;
                break;
            }
        }

        // 2. 該当するキャラクターが存在した場合
        if (mainName && this.iconNumberMap[mainName]) {
            const num = this.iconNumberMap[mainName];

            // サブキャラだけフォルダが違う仕様（902 が該当）
            const subFolder = mainName === '社長' ? 'sub_characters' : 'characters';

            this.iconPath = `images/content/${subFolder}/icon_circle_l/${num}.png`;
        } else {
            // 3. 不明キャラはデフォルト処理
            this.iconPath = `images/content/sub_characters/icon_circle_l/801.png`;
        }
    }

    createElement() {
        this.element = document.createElement('li');
        this.element.classList.add('message-li');
        this.element.classList.add(this.messageMode);
        this.element.dataset.nowBackground = this.nowBackground;

        this.element.innerHTML = `
            <div class="row-container">
                <img class="message-icon" src="${this.iconPath}">
                <div class="message-name">
                    <span>${this.data.speaker}</span>
                </div>
                <div class="message-text">
                    <span>${this.data.text.replace('\r\n', '<br>')}</span>
                    <div class="voice-play-button-container"></div>
                </div>
            </div>
        `;

        if ('voice' in this.data) {
            this.voicePlayButton = document.createElement('button');
            this.voicePlayButton.classList.add('voice-play-button', 'button-element');
            this.voicePlayButton.innerHTML = `
                <svg version="1.1" id="_x32_" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" viewBox="0 0 512 512" xml:space="preserve" class="button-element">
                    <g class="button-element">
                        <path class="st0 button-element" d="M25.232,175.83v160.34c0,33.299,26.997,60.303,60.295,60.303h112.275V115.542H85.527
                            C52.229,115.542,25.232,142.531,25.232,175.83z" style="fill: #615365;"></path>
                        <path class="st0 button-element" d="M477.003,3.023c-6.073-3.722-13.64-4.029-19.989-0.797L233.921,115.542v280.931l223.093,113.3
                            c6.349,3.233,13.916,2.927,19.989-0.795c6.065-3.722,9.765-10.324,9.765-17.462V20.483C486.768,13.361,483.068,6.745,477.003,3.023
                            z" style="fill: #615365;"></path>
                    </g>
                </svg>
            `;

            this.voicePlayButton.addEventListener('click', (e) => {
                this.audioController.playVoice(this.data.voice);
            });

            this.element.querySelector('.voice-play-button-container').appendChild(this.voicePlayButton);
        }

        // this.parentElement.prepend(this.element);
        this.parentElement.appendChild(this.element);
    }
}

class Select {
    constructor(eventController, eventData, index) {
        this.eventController = eventController;
        this.eventData = eventData;
        this.index = index;

        this.parentElement = document.querySelector('.message-ul');

        this.selectedIndex = -1;
        this.selectElements = [];

        this.getSelectEvents();
        this.createElement();
    }

    isActive() {
        return this.selectedIndex === -1;
    }

    getSelectEvents() {
        this.selectEvents = [];
        for (let i = this.index; i < this.eventData.length; i++) {
            const element = this.eventData[i];
            if ('select' in element) {
                this.selectEvents.push(element);
            }
            if ('setextCtrllect' in element && element.textCtrl === 'cm') break;
        }
    }

    createElement() {
        this.element = document.createElement('li');
        this.element.classList.add('select-li');

        const selectsContainer = document.createElement('div');
        selectsContainer.classList.add('selects-container');

        this.selectElements = [];
        this.selectEvents.forEach((e, idx) => {
            const selectContent = document.createElement('div');
            selectContent.classList.add('select-content');

            const selectText = document.createElement('span');
            selectText.classList.add('select-text');
            selectText.innerHTML = e.select.replace('\r\n', '<br>');
            selectContent.appendChild(selectText);

            selectContent.addEventListener('click', () => this.onClickSelect(idx));

            selectsContainer.appendChild(selectContent);
            this.selectElements.push(selectContent);
        });

        this.element.appendChild(selectsContainer);
        this.parentElement.appendChild(this.element);
    }

    onClickSelect(idx) {
        if (this.selectedIndex === idx) return;

        this.selectedIndex = idx;

        const selectContents = this.element.querySelectorAll('.select-content');
        selectContents.forEach((div, index) => {
            if (index === idx) {
                div.classList.add('selected');
                div.classList.remove('unselected');
            } else {
                div.classList.add('unselected');
                div.classList.remove('selected');
            }
        });

        // 選択肢以降の要素を削除
        this.removeElementsAfterSelect();

        // 次のターンへ進む
        this.eventController.nowPageIndex = this.getNextIndex();
    }

    // 次のターンで選択肢の分岐先へジャンプ
    getNextIndex() {
        if (this.selectedIndex === -1) return this.index;
        const targetLabel = this.selectEvents[this.selectedIndex].nextLabel;
        for (let i = 0; i < this.eventData.length; i++) {
            const e = this.eventData[i];
            if ('label' in e && e.label === targetLabel) {
                return i;
            }
        }
        return this.index;
    }

    // this.parentElementから選択肢以降の要素を削除
    removeElementsAfterSelect() {
        let foundSelect = false;
        const children = Array.from(this.parentElement.children);
        for (const child of children) {
            if (child === this.element) {
                foundSelect = true;
                continue;
            }
            if (foundSelect) {
                child.remove();
            }
        }
    }
}

class AudioController {
    firstTime = true;
    _destroyed = false;

    bgm_volume = 0.3;
    se_volume = 0.4;
    voice_volume = 0.4;

    constructor() {
        this.audioCtx = new AudioContext();

        this.bgm_source = this.audioCtx.createBufferSource();
        this.se_source = this.audioCtx.createBufferSource();
        this.voice_source = this.audioCtx.createBufferSource();

        this.bgm_gainNode = this.audioCtx.createGain();
        this.se_gainNode = this.audioCtx.createGain();
        this.voice_gainNode = this.audioCtx.createGain();

        this.bgm_gainNode.connect(this.audioCtx.destination);
        this.se_gainNode.connect(this.audioCtx.destination);
        this.voice_gainNode.connect(this.audioCtx.destination);

        this.bgm_gainNode.gain.value = this.bgm_volume;
        this.se_gainNode.gain.value = this.se_volume;
        this.voice_gainNode.gain.value = this.voice_volume;

        this.initAudioContext = this.initAudioContext.bind(this);
        document.addEventListener('touchstart', this.initAudioContext);

        // プリロード用キャッシュ
        this.cache = {
            bgm: {},
            se: {},
            voice: {},
        };
    }

    async initAudioContext() {
        if (!this.firstTime) return;
        let emptySource = this.audioCtx.createBufferSource();
        emptySource.start();
        emptySource.stop();
        emptySource = null;
        this.firstTime = false;
    }

    async getFile(filepath) {
        if (!filepath) return null;
        try {
            const response = await fetch(filepath);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
            return audioBuffer;
        } catch (e) {
            console.error('Error fetching audio file:', e);
            return null;
        }
    }

    // ローカル → オンライン フェールオーバー付き取得
    async getFileWithFallback(localUrl, onlineUrl) {
        // 1. ローカル試行
        try {
            const resLocal = await fetch(localUrl);
            if (resLocal.ok) {
                return await resLocal.arrayBuffer();
            }
            throw new Error(`Local fetch failed: ${resLocal.status}`);
        } catch (_) {
            // ローカル失敗 → オンラインへ
        }

        // 2. オンライン試行
        try {
            const resOnline = await fetch(onlineUrl);
            if (!resOnline.ok) {
                throw new Error(`Online fetch failed: ${resOnline.status}`);
            }
            return await resOnline.arrayBuffer();
        } catch (e) {
            console.error(`Failed to fetch both local and online audio:`, e);
            throw e;
        }
    }

    // ==== プリロード ====
    async preload(files, type = 'voice') {
        // files: 配列 ['bgm/000.m4a', 'se/001.m4a', ...]
        for (const file of files) {
            if (!this.cache[type][file]) {
                this.cache[type][file] = await this.getFile(file);
            }
        }
    }

    // ==== 再生 ====
    _playFromCache(source, gainNode, track, loop = false) {
        source = this.unloadSource(source);
        source.buffer = track;
        source.loop = loop;
        source.connect(gainNode);

        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();
        source.start();
        return source;
    }

    async playBGM(id) {
        const local = `${LOCAL_ASSETS_PATH}sounds/bgm/${id}.m4a`;
        const online = `https://viewer.shinycolors.moe/sounds/bgm/${id}.m4a`;

        const cacheKey = `bgm:${id}`;

        if (!this.cache.bgm[cacheKey]) {
            const buffer = await this.getFileWithFallback(local, online);
            this.cache.bgm[cacheKey] = await this.audioCtx.decodeAudioData(buffer);
        }

        this.bgm_gainNode.gain.value = this.bgm_volume;
        this.bgm_source = this._playFromCache(this.bgm_source, this.bgm_gainNode, this.cache.bgm[cacheKey], true);
    }

    async playSE(id) {
        const local = `${LOCAL_ASSETS_PATH}sounds/se/event/${id}.m4a`;
        const online = `https://viewer.shinycolors.moe/sounds/se/event/${id}.m4a`;

        const cacheKey = `se:${id}`;

        if (!this.cache.se[cacheKey]) {
            const buffer = await this.getFileWithFallback(local, online);
            this.cache.se[cacheKey] = await this.audioCtx.decodeAudioData(buffer);
        }

        this.se_gainNode.gain.value = this.se_volume;
        this.se_source = this._playFromCache(this.se_source, this.se_gainNode, this.cache.se[cacheKey]);
    }

    async playVoice(id) {
        const local = `${LOCAL_ASSETS_PATH}sounds/voice/events/${id}.m4a`;
        const online = `https://viewer.shinycolors.moe/sounds/voice/events/${id}.m4a`;

        const cacheKey = `voice:${id}`;

        if (!this.cache.voice[cacheKey]) {
            const buffer = await this.getFileWithFallback(local, online);
            this.cache.voice[cacheKey] = await this.audioCtx.decodeAudioData(buffer);
        }

        this.voice_gainNode.gain.value = this.voice_volume;
        this.voice_source = this._playFromCache(this.voice_source, this.voice_gainNode, this.cache.voice[cacheKey]);
    }

    unloadSource(source) {
        try {
            source.stop();
        } catch {}
        try {
            source.disconnect();
        } catch {}
        return this.audioCtx.createBufferSource();
    }

    stopBGM() {
        this.bgm_source = this.unloadSource(this.bgm_source);
    }
    stopSE() {
        this.se_source = this.unloadSource(this.se_source);
    }
    stopVoice() {
        this.voice_source = this.unloadSource(this.voice_source);
    }

    fadeOutBGM() {
        this.bgm_gainNode.gain.cancelScheduledValues(0);
        this.bgm_gainNode.gain.linearRampToValueAtTime(this.bgm_volume, this.audioCtx.currentTime);
        this.bgm_gainNode.gain.linearRampToValueAtTime(0, this.audioCtx.currentTime + 0.33);
    }

    destroy() {
        if (this._destroyed) return;
        this._destroyed = true;
        document.removeEventListener('touchstart', this.initAudioContext);
        this._safeKillSource(this.bgm_source);
        this._safeKillSource(this.se_source);
        this._safeKillSource(this.voice_source);
        this._safeTearDownGain(this.bgm_gainNode);
        this._safeTearDownGain(this.se_gainNode);
        this._safeTearDownGain(this.voice_gainNode);
        try {
            this.audioCtx.close();
        } catch {}
        this.audioCtx = null;
        this.cache = null;
    }

    _safeTearDownGain(gainNode) {
        if (!gainNode) return;
        try {
            gainNode.gain.cancelScheduledValues(0);
        } catch {}
        try {
            gainNode.disconnect();
        } catch {}
    }
    _safeKillSource(node) {
        if (!node) return;
        try {
            node.stop(0);
        } catch {}
        try {
            node.disconnect();
        } catch {}
    }
}

class ShinyTools {
    static async generatePath(inputPath) {
        inputPath = inputPath.replaceAll('\\', '/');

        const hash = await ShinyTools.encryptPath(inputPath);
        const assetExtname = '.' + inputPath.split('.').pop();
        const extname = assetExtname === '.mp4' || assetExtname === '.m4a' ? assetExtname : '';

        return `https://shinycolors.enza.fun/assets/${hash}${extname}`;
    }

    static async encryptPath(inputPath) {
        inputPath = inputPath.replaceAll('\\', '/');

        const basename = inputPath.split('/').pop().split('.')[0];

        const key = `${basename[0]}${basename[basename.length - 1]}/assets/${inputPath}`;
        return await ShinyTools.async_digestMessage(key);
    }

    static async_digestMessage(message) {
        return new Promise(function (resolve) {
            var msgUint8 = new TextEncoder('utf-8').encode(message);
            crypto.subtle.digest('SHA-256', msgUint8).then(function (hashBuffer) {
                var hashArray = Array.from(new Uint8Array(hashBuffer));
                var hashHex = hashArray
                    .map(function (b) {
                        return b.toString(16).padStart(2, '0');
                    })
                    .join('');
                return resolve(hashHex);
            });
        });
    }
}

// URLパラメータを取得する
function getCurrentUrlParams() {
    const params = new URLSearchParams(window.location.search);

    const result = {};

    for (const key of params.keys()) {
        const values = params.getAll(key);
        result[key] = values.length > 1 ? values : values[0];
    }

    return result;
}

// 再生するイベントを入力させる
function promptEvent() {
    const input = prompt('イベントデータのパスを入力してください。\n（例）game_event_communications\\400106901.json');

    if (!input) return;

    const eventId = input.split('\\').pop().split('.')[0];
    const eventType = input.split('\\')[0];
    window.location.search = `?eventId=${eventId}&eventType=${eventType}&allView=false`;
}

async function init() {
    const params = getCurrentUrlParams();

    // URLパラメータが存在しない場合はイベントデータの入力を促す
    if (!Object.keys(params).length) {
        promptEvent();
        return;
    }

    // URLパラメータが不正な場合はイベントデータの入力を促す
    if (!params.eventId || !params.eventType) {
        alert('URLパラメータが不正です。\n再度イベントデータのパスを入力してください。');
        promptEvent();
        return;
    }

    // allViewパラメータが存在しない場合はデフォルト値を設定
    if (params.allView == undefined) {
        params.allView = false;
        window.location.search = `?eventId=${params.eventId}&eventType=${params.eventType}&allView=false`;
        return;
    }

    // allViewパラメータの値を取得
    const allView = String(params.allView).toLowerCase() === 'true';

    // AudioControllerの初期化
    const audioController = new AudioController();

    // EventControllerの初期化
    new EventController(params.eventId, params.eventType, allView, audioController).init();
}
init();
