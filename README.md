MAKEUP BY NUREEN — UPDATED WEBSITE FILES

FILES IN THIS BUNDLE
- index.html       Complete admin dashboard replacement.
- book.html        Complete public customer booking page replacement.
- firestore.rules  Complete Firestore Security Rules replacement.

BEFORE YOU REPLACE ANYTHING
1. Keep a backup copy of your current index.html and book.html.
2. Download a JSON backup from Admin > Settings > Backup & Restore.
3. Save a copy of your existing Firestore Rules.

REPLACE THE WEBSITE FILES
1. Unzip this bundle.
2. In the root of your website repository, replace the existing index.html with the included index.html.
3. Replace the existing book.html with the included book.html.
4. Commit/push the two replacements and deploy them using your hosting setup.

UPDATE FIRESTORE RULES
1. Open Firebase Console > Firestore Database > Rules.
2. Replace the rules with the included firestore.rules and publish.
3. IMPORTANT: The isAdmin() function retains the admin UID you supplied earlier:
   lGzZypXcTogMF4FajXx7Oe2ntpE2
   Confirm this exactly matches the UID of the account you use to sign in under Firebase Authentication > Users. If it does not match, update that one UID in the rules before publishing. A mismatch will block the admin app from reading/writing private studio data.

SET THE DAILY BOOKING LIMIT
1. Sign in to the admin app.
2. Open Settings > Public Booking Page.
3. Set “Maximum bookings per day” to 3 (this is also the default).
4. Save public page settings.

HOW THE LIMIT WORKS
- Each saved booking is one booking, regardless of the number of people in that booking.
- Approved customer requests and jobs manually added in the admin app count toward the daily limit.
- Pending requests do not count until approved. Declined requests do not count.
- The current app has no separate cancelled-booking status; deleting a booking frees that place.
- Payment status (Unpaid, Deposit Paid, Fully Paid) does not affect the booking count.
- Approval checks both the daily limit and appointment/travel-buffer conflict in a Firestore transaction.
- Existing backup restores and Google Calendar imports are preserved even if they contain more than the limit. Those dates will show as full to new public customers.
- The private daily-capacity ledger is created automatically under studios/{your-admin-uid}/dailyCapacity. You do not need to create those documents manually.
- A live connection is required when creating, editing, deleting or approving bookings so the app can check the shared daily limit safely.

PENDING DEPOSITS
The public confirmation page now tells customers not to pay until the request has been approved. It hides the DuitNow QR on the pending confirmation screen.

TESTING NOTE
The JavaScript module syntax was checked for both HTML files. The files have not been connected to or tested against your live Firebase project from this environment. After deployment, test with a spare future date before sharing the public booking link widely.
