(() => {
            const els = {
                overlay: document.getElementById('modal-overlay'),
                modAnnounce: document.getElementById('modal-announcement'),
                cntAnnounce: document.getElementById('content-announcement'),
                btnAnnounce: document.getElementById('btn-accept-announcement'),
                hntAnnounce: document.getElementById('hint-announcement'),
                modLegal: document.getElementById('modal-legal'),
                cntLegal: document.getElementById('content-legal'),
                btnLegal: document.getElementById('btn-accept-legal'),
                hntLegal: document.getElementById('hint-legal'),
                mainInterface: document.getElementById('main-interface'),
                textarea: document.getElementById('submission-content'),
                charCounter: document.getElementById('char-counter'),
                btnSubmit: document.getElementById('btn-submit'),
                modSuccess: document.getElementById('modal-success'),
                successIdDisplay: document.getElementById('success-id-display'),
                btnCloseSuccess: document.getElementById('btn-close-success'),
                toast: document.getElementById('toast')
            };

            const SENSITIVE_WORDS = ['髒話', '去死', '笨蛋', '智障', '垃圾', '幹', '機掰', '靠北', '三小'];
            const SCROLL_TOLERANCE = 15;

            function checkScrollUnlock(container, button, hint) {
                if (!container || !button) return;
                if (container.scrollHeight <= container.clientHeight + SCROLL_TOLERANCE) {
                    unlockButton(button, hint);
                    return;
                }
                const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
                if (scrollBottom <= SCROLL_TOLERANCE) {
                    unlockButton(button, hint);
                }
            }

            function unlockButton(button, hint) {
                button.disabled = false;
                button.className = button.id === 'btn-accept-announcement' 
                    ? "w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-3.5 rounded-xl transition-all text-sm cursor-pointer shadow-lg shadow-amber-500/20"
                    : "w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 rounded-xl transition-all text-sm cursor-pointer shadow-lg shadow-blue-600/20";
                
                hint.textContent = "✓ 已滑動至最底部，請點擊按鈕繼續";
                hint.classList.add('text-emerald-600');
                hint.classList.remove('text-slate-500');
            }

            function initScrollLogic(container, button, hint) {
                setTimeout(() => checkScrollUnlock(container, button, hint), 150);
                container.addEventListener('scroll', () => {
                    if (button.disabled) checkScrollUnlock(container, button, hint);
                });
                window.addEventListener('resize', () => {
                    if (button.disabled && container.offsetParent !== null) checkScrollUnlock(container, button, hint);
                });
            }

            async function loadAnnouncement() {
                try {
                    let res = await fetch('/api/data?public=aa&t=' + Date.now());
                    if (!res.ok) res = await fetch('aa.json?t=' + Date.now());
                    if (!res.ok) throw new Error('aa.json not found');
                    const data = await res.json();
                    
                    if (typeof data === 'object' && data.content) {
                        els.cntAnnounce.innerHTML = data.content;
                    } else if (typeof data === 'string') {
                        els.cntAnnounce.innerHTML = data;
                    } else {
                        els.cntAnnounce.innerHTML = `<p class="font-bold text-base text-amber-700">歡迎使用匿名啟英 CY</p><p>${JSON.stringify(data)}</p>`;
                    }
                } catch (err) {
                    els.cntAnnounce.innerHTML = `
                        <div class="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                            <p class="font-bold text-amber-700 text-base">【平台最新公告】</p>
                            <p class="text-slate-700">歡迎來到匿名啟英 CY 學生自研投稿平台！</p>
                            <ul class="list-disc pl-5 space-y-1 text-xs text-slate-600">
                                <li>全平台響應式設計，支援手機與電腦瀏覽。</li>
                                <li>自動化敏感詞彙過濾與個人隱私防護。</li>
                            </ul>
                        </div>
                    `;
                }
                initScrollLogic(els.cntAnnounce, els.btnAnnounce, els.hntAnnounce);
            }

            // 通知開場畫面：公告已載入（成功或使用備用內容），頁面可以放行了
            loadAnnouncement().finally(() => {
                window.__cyAppReady = true;
                window.dispatchEvent(new Event('cy:ready'));
            });

            els.btnAnnounce.addEventListener('click', () => {
                els.modAnnounce.classList.add('hidden');
                els.modLegal.classList.remove('hidden');
                els.modLegal.classList.add('flex', 'pop-in');
                initScrollLogic(els.cntLegal, els.btnLegal, els.hntLegal);
            });

            els.btnLegal.addEventListener('click', () => {
                els.overlay.classList.add('opacity-0');
                setTimeout(() => {
                    els.overlay.classList.add('hidden');
                    els.mainInterface.classList.remove('hidden');
                    els.mainInterface.classList.add('flex', 'fade-in');
                }, 300);
            });

            els.textarea.addEventListener('input', (e) => {
                const length = e.target.value.length;
                els.charCounter.textContent = length;
                if (length >= 300) els.charCounter.classList.add('text-rose-400');
                else els.charCounter.classList.remove('text-rose-400');
            });

            function showToast(msg) {
                els.toast.textContent = msg;
                els.toast.classList.remove('opacity-0', '-translate-y-10');
                els.toast.classList.add('opacity-100', 'translate-y-0');
                setTimeout(() => {
                    els.toast.classList.remove('opacity-100', 'translate-y-0');
                    els.toast.classList.add('opacity-0', '-translate-y-10');
                }, 3000);
            }

            function sanitizeHtml(str) {
                return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            }

            function generateSecretId() {
                return Math.floor(Math.random() * 16777215).toString(16).toUpperCase().padStart(6, '0');
            }

            async function fetchUserIP() {
                try {
                    const res = await fetch('https://api.ipify.org?format=json');
                    if (res.ok) {
                        const data = await res.json();
                        return data.ip || 'Unknown';
                    }
                } catch (e) {}
                return '127.0.0.1';
            }

            els.btnSubmit.addEventListener('click', async () => {
                const rawText = els.textarea.value.trim();

                if (!rawText) {
                    showToast('請輸入投稿內容！');
                    return;
                }

                const containsSensitive = SENSITIVE_WORDS.some(word => rawText.includes(word));
                if (containsSensitive) {
                    showToast('內容包含敏感或不當詞彙，請修改後再試！');
                    return;
                }

                const originalBtnContent = els.btnSubmit.innerHTML;
                els.btnSubmit.disabled = true;
                els.btnSubmit.innerHTML = `
                    <div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    <span>資料處理中...</span>
                `;

                try {
                    const cleanContent = sanitizeHtml(rawText);
                    const result = await saveToGitHub({ content: cleanContent });
                    const postId = result.id;

                    els.successIdDisplay.textContent = `投稿識別碼 ${postId}`;
                    els.modSuccess.classList.remove('hidden');
                    els.modSuccess.classList.add('flex');

                    els.textarea.value = '';
                    els.charCounter.textContent = '0';

                } catch (err) {
                    console.error('Submission failed:', err);
                    showToast('投稿發送失敗：' + err.message);
                } finally {
                    els.btnSubmit.disabled = false;
                    els.btnSubmit.innerHTML = originalBtnContent;
                }
            });

            // 編號、識別碼、時間、IP 全部由伺服器 (/api/submit) 產生並寫入 ab.json / ak.json
            async function saveToGitHub(payload) {
                const res = await fetch('/api/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.success) {
                    throw new Error(data.error || '投稿寫入失敗');
                }
                return data;
            }

            els.btnCloseSuccess.addEventListener('click', () => {
                els.modSuccess.classList.add('hidden');
                els.modSuccess.classList.remove('flex');
            });
        })();
