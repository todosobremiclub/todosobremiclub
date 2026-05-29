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

  prev.onclick = () => { index = (index - 1 + slides.length) % slides.length; update(); };
  next.onclick = () => { index = (index + 1) % slides.length; update(); };

  dots.forEach((d, i) => d.onclick = () => { index = i; update(); });

  update();
});