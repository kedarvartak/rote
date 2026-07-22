<?php
/**
 * Exposes WordPress's existing screen-reader checkbox names directly on inputs.
 *
 * Browser harnesses should not need to infer a checkbox identity from a nearby
 * numeric title. This mirrors the label WordPress already renders for people
 * using assistive technology; it does not expose benchmark-only selectors.
 */
add_action('admin_footer-edit.php', function () {
    ?>
    <script>
    for (const checkbox of document.querySelectorAll('#the-list input[name="post[]"]')) {
        const label = document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`);
        const name = label?.textContent?.trim();
        if (name) checkbox.setAttribute('aria-label', name);
    }
    </script>
    <?php
});
