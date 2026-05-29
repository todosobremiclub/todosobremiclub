document.addEventListener("DOMContentLoaded", () => {
  const track = document.querySelector(".hero-track");
  const slides = document.querySelectorAll(".hero-slide");
  const prev = document.querySelector(".hero-nav.prev");
  const next = document.querySelector(".hero-nav.next");

  if (!track || slides.length === 0 || !prev || !next) return;

  let index = 0;

  function updateHeroCarousel() {
    track.style.transform = `translateX(-${index * 100}%)`;
  }

  prev.addEventListener("click", () => {
    index = (index - 1 + slides.length) % slides.length;
    updateHeroCarousel();
  });

  next.addEventListener("click", () => {
    index = (index + 1) % slides.length;
    updateHeroCarousel();
  });
});