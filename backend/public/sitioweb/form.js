const modal = document.getElementById("demo-modal");
const openButtons = document.querySelectorAll("[data-open-form]");
const closeButton = modal.querySelector(".modal-close");

openButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  });
});

closeButton.addEventListener("click", () => {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
});

document.getElementById("demo-form").addEventListener("submit", async e => {
  e.preventDefault();

  const form = e.target;
  const data = {
    nombre: form.nombre.value,
    club: form.club.value,
    socios: form.socios.value,
    telefono: form.telefono.value
  };

  try {
    const res = await fetch("/api/demo-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error();

    form.innerHTML = `
      <p style="text-align:center; font-size:16px;">
        ✅ <strong>Solicitud enviada</strong><br>
        Nos vamos a contactar a la brevedad.
      </p>
    `;
  } catch {
    alert("Ocurrió un error al enviar la solicitud.");
  }
});