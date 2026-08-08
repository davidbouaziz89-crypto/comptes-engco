-- Marketing IA — modèles de style pour CALL IA.
-- Trois posts que David a réellement publiés et validés en juillet 2026
-- (dossier ~/Desktop/CALL IA, fichiers legendes-posts-conseils.txt et
-- legendes-posts-secteurs.txt). L'IA s'en servira comme référence de style.
-- À lancer APRÈS sql/mkt-exemples.sql, dans l'éditeur SQL Supabase.

update public.mkt_editorial set exemples = $modeles$
POST 1 — « 3 signes que vos fichiers sont morts »

Vos commerciaux passent 100 appels pour 2 réponses ? Vos fichiers sont peut-être « morts ».

3 signes qui ne trompent pas :
❌ Numéros injoignables ou faux
❌ Contacts déjà sur-sollicités (fichiers revendus 50 fois)
❌ Données périmées (le décisionnaire est parti depuis 2 ans)

La solution : arrêter d'acheter des bases recyclées et générer vos leads B2B à la demande — frais, exclusifs et prêts à appeler.

👉 Devis sur www.leadscall-ia.com

#prospection #leadsB2B #développementcommercial #B2B #IA #generationdeleads

---

POST 2 — « Un contact n'est pas un lead qualifié »

Un numéro de téléphone, ce n'est pas un lead. 📞

Un lead VRAIMENT qualifié, c'est :
✅ une entreprise qui correspond à votre cible (secteur, taille, zone)
✅ le bon décisionnaire identifié
✅ des coordonnées vérifiées et à jour
✅ un contact frais, pas sur-sollicité

Le reste, c'est du bruit qui épuise vos équipes.

👉 www.leadscall-ia.com

#leadsB2B #prospection #B2B

---

POST 3 — secteur Télécom

Vous vendez de la fibre, du mobile ou des solutions de téléphonie d'entreprise ? 📞

On cible pour vous les professionnels au bon moment : ceux qui arrivent en fin de contrat, qui déménagent ou qui cherchent à réduire leur facture télécom.

✅ Le bon décisionnaire identifié
✅ Des contacts frais et exclusifs
✅ Livrés dans votre CRM, prêts à appeler

CALL IA connaît votre métier : on cible les bons pros, au bon moment.

👉 www.leadscall-ia.com

#télécom #fibre #leadsB2B #prospection #B2B
$modeles$
where company_id = (select id from public.mkt_companies where name = 'CALL IA' limit 1);
