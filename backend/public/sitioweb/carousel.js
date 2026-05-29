document.addEventListener("DOMContentLoaded", () => {
  const track = document.querySelector(".hero-track");
  const slides = Array.from(document.querySelectorAll(".hero-slide"));
  const prev = document.querySelector(".hero-nav.prev");
  const next = document.querySelector(".hero-nav.next");
  const dots = Array.from(document.querySelectorAll(".hero-dots .dot"));

  let index = 0;

  function update() {
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle("active", i === index));
  }

  prev.onclick = () => {
    index = (index - 1 + slides.length) % slides.length;
    update();
  };

  next.onclick = () => {
    index = (index + 1) % slides.length;
    update();
  };

  dots.forEach((d, i) => {
    d.onclick = () => {
      index = i;
      update();
    };
  });

  /* ===== SWIPE REAL ===== */
  let startX = 0;
  let currentX = 0;
  let isDragging = false;

  track.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
    isDragging = true;
  }, { passive: true });

  track.addEventListener("touchmove", (e) => {
    if (!isDragging) return;
    currentX = e.touches[0].clientX;
  }, { passive: true });

  track.addEventListener("touchend", () => {
    if (!isDragging) return;
    const diff = currentX - startX;
    isDragging = false;

    if (Math.abs(diff) > 50) {
      if (diff < 0) {
        index = Math.min(index + 1, slides.length - 1);
      } else {
        index = Math.max(index - 1, 0);
      }
      update();
    }
  });

  update();
});