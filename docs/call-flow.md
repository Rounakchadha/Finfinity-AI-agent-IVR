# Call Flow — Sample Conversation

## Full Conversation Transcript

This shows exactly what happens during a real test call.

---

```
🤖 AGENT: "Hello! This is Finfinity's automated loan intake assistant.
           I will ask you a few quick questions to set up your loan enquiry.
           This call may be recorded for quality purposes.
           Do you give your consent to continue?"

👤 USER:  "Yeah sure go ahead"

🤖 AGENT: "Thank you for your consent. May I have your full name please?"

👤 USER:  "My name is Rounak Chadha"

🤖 AGENT: "Thank you. Could you please confirm your 10-digit mobile number?"

👤 USER:  "It's 9876543210"

🤖 AGENT: "Which city are you currently residing in?"

👤 USER:  "I'm in Mumbai"

🤖 AGENT: "What is your area pincode?"

👤 USER:  "400001"

🤖 AGENT: "Which loan product are you interested in?
           Please say one of the following: Home Loan, Personal Loan,
           Business Loan, Loan Against Property, Credit Card, or Other."

👤 USER:  "I want a home loan"

🤖 AGENT: "What is the approximate loan amount you are looking for?
           You can say: Under 5 Lakhs, 5 to 20 Lakhs,
           20 to 50 Lakhs, or Above 50 Lakhs."

👤 USER:  "Around 30 to 40 lakhs"
          ↳ Groq extracts: { "loan_amount_range": "20-50 Lakhs" }

🤖 AGENT: "How soon do you need this loan?
           Please say: Today, This Week, or I am Exploring."

👤 USER:  "This week"

🤖 AGENT: "Are you Salaried or Self-Employed?"

👤 USER:  "I'm salaried"

🤖 AGENT: "What is your approximate monthly income?
           You can say: Under 25 thousand, 25 to 50 thousand,
           50 thousand to 1 lakh, or Above 1 lakh."

👤 USER:  "About 80 thousand"
          ↳ Groq extracts: { "monthly_income": "50K-1L" }

🤖 AGENT: "When would you prefer a callback from our Relationship Manager?
           Please say: Right Now, Later Today, or This Evening."

👤 USER:  "This evening would be fine"

🤖 AGENT: "Would you like to share your email address for updates?
           You can also say Skip."

👤 USER:  "rounak@example.com"

🤖 AGENT: "Thank you! Let me read back your details.
           Name: Rounak Chadha, Phone: 9876543210, Mumbai,
           Pincode 400001, Home Loan, 20-50 Lakhs,
           needed This week, Salaried, income 50K-1L,
           callback Evening, email rounak@example.com.
           Is all of that correct?"

👤 USER:  "yes that's correct"

🤖 AGENT: "Perfect! Your loan enquiry has been successfully submitted.
           A relationship manager from Finfinity will contact you
           at your preferred time. Thank you for choosing Finfinity.
           Have a wonderful day. Goodbye!"

📞 [CALL ENDS]
```

---

## Multi-Answer Handling

The state machine skips questions the user already answered:

```
👤 USER (on FULL_NAME question):
   "My name is Rounak, I'm calling from Mumbai, pincode 400001"

   ↳ Groq extracts:
     { "full_name": "Rounak", "city": "Mumbai", "pincode": "400001" }

   ↳ State machine SKIPS PHONE, CITY, PINCODE
     (since city and pincode are already collected)

   ↳ Next question asked: PHONE (since that's still missing)
```

## Correction Flow

```
🤖 AGENT: "...Mumbai, Pincode 400001... Is all of that correct?"

👤 USER:  "No, the city is wrong, it should be Pune"

🤖 AGENT: "Sure, I can correct that. Please tell me which detail
           you would like to change and the new value."

👤 USER:  "The city should be Pune"

          ↳ Groq correction extraction:
            { "correction_field": "city", "correction_value": "Pune" }

🤖 AGENT: "Got it, I've updated that. Here are your updated details:
           ..., Pune, Pincode 400001 ...
           Is that correct now?"

👤 USER:  "Yes"

🤖 AGENT: [Creates lead → Notifies n8n → Says goodbye]
```
