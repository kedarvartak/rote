<?php
/** Uses WordPress's built-in classic editor for deterministic title-review tasks. */
add_filter('use_block_editor_for_post', '__return_false');
