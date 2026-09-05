document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => { const s = document.getElementById('splash'); if(s) { s.style.opacity = '0'; setTimeout(() => s.style.display = 'none', 400); } }, 1000);
            const setupModal = (tId, mId) => {
                const t = document.getElementById(tId); const m = document.getElementById(mId); if (!t || !m) return;
                t.addEventListener('click', (e) => { e.preventDefault(); m.classList.add('active'); });
                m.querySelector('.close-modal').addEventListener('click', () => m.classList.remove('active'));
                m.addEventListener('click', (e) => { if(e.target === m) m.classList.remove('active'); });
            };
            const urlReal = window.location.href;
            setupModal('nav-services', 'modal-services'); setupModal('nav-gallery', 'modal-gallery'); setupModal('nav-testimonials', 'modal-testimonials'); setupModal('nav-coverage', 'modal-coverage'); setupModal('nav-share', 'modal-qr');
            const qrBox = document.getElementById("qrcode"); if(qrBox) { new QRCode(qrBox, { text: urlReal, width: 144, height: 144, colorDark : "#111111", colorLight : "#ffffff", correctLevel : QRCode.CorrectLevel.H }); }
        });
