<?php
// Deterministic benchmark corpus: enough rows to produce a real 10K+ token admin page.
for ($index = 1; $index <= 120; $index++) {
    $title = sprintf('Rote curve post %03d', $index);
    $existing = get_posts([
        'post_type' => 'post',
        // `any` deliberately excludes trash in WP_Query; enumerate it so reset
        // restores task mutations instead of inserting duplicate benchmark rows.
        'post_status' => ['publish', 'draft', 'pending', 'private', 'future', 'trash'],
        'title' => $title,
        'posts_per_page' => -1,
    ]);
    $timestamp = strtotime('2026-01-01 00:00:00 UTC') + ($index * 60);
    $post = [
        'post_title' => $title,
        'post_content' => sprintf(
            'Procurement record %03d for the deterministic Rote working-memory benchmark.',
            $index
        ),
        'post_date' => gmdate('Y-m-d H:i:s', $timestamp),
        'post_date_gmt' => gmdate('Y-m-d H:i:s', $timestamp),
        'post_status' => 'publish',
        'post_type' => 'post',
    ];
    if ($existing) {
        $primary = array_shift($existing);
        $post['ID'] = $primary->ID;
        wp_update_post($post);
        foreach ($existing as $duplicate) {
            wp_delete_post($duplicate->ID, true);
        }
    } else {
        wp_insert_post($post);
    }
}

$admin = get_user_by('login', 'rote-admin');
update_user_meta($admin->ID, 'edit_post_per_page', 100);
update_user_meta($admin->ID, 'show_welcome_panel', 0);

$published = new WP_Query([
    'post_type' => 'post',
    'post_status' => 'publish',
    's' => 'Rote curve post',
    'posts_per_page' => -1,
]);
$trashed = new WP_Query([
    'post_type' => 'post',
    'post_status' => 'trash',
    's' => 'Rote curve post',
    'posts_per_page' => -1,
]);
if ($published->found_posts !== 120 || $trashed->found_posts !== 0) {
    throw new RuntimeException(sprintf(
        'Seed invariant failed: expected 120 published and 0 trashed posts, got %d and %d',
        $published->found_posts,
        $trashed->found_posts
    ));
}
