const slides = document.querySelectorAll(".carousel-slide");
const track = document.querySelector(".carousel-track");
const prev = document.querySelector(".carousel-btn.prev");
const next = document.querySelector(".carousel-btn.next");

let index = 0;

function updateCarousel() {
  track.style.transform = `translateX(-${index * 100}%)`;
  slides.forEach((s, i) => {
    s.classList.toggle("active", i === index);
  });
}

prev.addEventListener("click", () => {
  index = (index - 1 + slides.length) % slides.length;
  updateCarousel();
});

next.addEventListener("click", () => {
  index = (index + 1) % slides.length;
  updateCarousel();
});