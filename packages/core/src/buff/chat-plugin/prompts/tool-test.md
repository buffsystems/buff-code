Test a chat plugin: check its files, then have the user's app draw each of its examples in the real frame and report back — drawn (with its height) or the error the view threw.

Call it after every `chat_plugin_save` and after editing a plugin's files. Do not tell the user a plugin works without a passed test. A view that drew is not yet a view that looks right: after a pass, show one example block in your reply and ask the user.

- id: the plugin.

Returns problems of the files, warnings (web addresses in the view never load), and the drawing result per example. "No answer" means the user's app could not confirm — then ask the user what they see.
