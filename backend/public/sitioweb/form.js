<script>
  const modal = document.getElementById("demo-modal");
  const openBtns = document.querySelectorAll("[data-open-form]");
  const closeBtn = document.querySelector(".modal-close");

  openBtns.forEach(btn =>
    btn.addEventListener("click", () => modal.classList.add("open"))
  );

  closeBtn.addEventListener("click", () => modal.classList.remove("open"));
</script>